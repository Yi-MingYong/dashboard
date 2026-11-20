/**
 * Verifies the Cloudflare Access application token (Cf-Access-Jwt-Assertion).
 * Workers with static assets do not receive ctx.access, so the Worker checks the
 * RS256 signature against the team's published keys and validates the claims itself.
 */

export interface AccessConfig {
  /** e.g. "isdashboard.cloudflareaccess.com" */
  teamDomain: string;
  aud: string;
}

export interface AccessIdentity {
  email: string;
  exp: number;
}

export type Fetcher = (url: string) => Promise<Response>;

export class AccessError extends Error {}

const LEEWAY = 60;
const JWKS_TTL = 3600;
const REFETCH_AFTER = 30;

interface KeySet {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}
const cache = new Map<string, Promise<KeySet>>();

export function resetKeyCache(): void {
  cache.clear();
}

export function normalizeTeamDomain(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function b64urlBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new AccessError('encoding');
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function b64urlJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  throw new AccessError('malformed');
}

/** Unverified claims, only used to show the visitor which values to configure. */
export function peekToken(token: string | null): { iss?: string; aud?: string[]; email?: string } {
  try {
    const p = b64urlJson(token?.split('.')[1] ?? '');
    const aud = typeof p.aud === 'string' ? [p.aud] : Array.isArray(p.aud) ? p.aud.filter((a): a is string => typeof a === 'string') : undefined;
    return { iss: typeof p.iss === 'string' ? p.iss : undefined, aud, email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : undefined };
  } catch {
    return {};
  }
}

async function loadKeys(team: string, fetcher: Fetcher, now: number): Promise<KeySet> {
  const res = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AccessError(`certs ${res.status}`);
  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of body.keys ?? []) {
    if (k.kty !== 'RSA' || !k.kid || !k.n || !k.e) continue;
    keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  return { keys, fetchedAt: now };
}

async function keyFor(team: string, kid: string, fetcher: Fetcher, now: number): Promise<CryptoKey> {
  const cached = cache.get(team);
  let set = cached ? await cached.catch(() => null) : null;
  if (!set || now - set.fetchedAt > JWKS_TTL || (!set.keys.has(kid) && now - set.fetchedAt > REFETCH_AFTER)) {
    const p = loadKeys(team, fetcher, now);
    cache.set(team, p);
    p.catch(() => cache.get(team) === p && cache.delete(team));
    set = await p;
  }
  const key = set!.keys.get(kid);
  if (!key) throw new AccessError('unknown key');
  return key;
}

export async function verifyAccessToken(token: string, cfg: AccessConfig, opts: { now?: number; fetcher?: Fetcher } = {}): Promise<AccessIdentity> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const fetcher = opts.fetcher ?? ((u: string) => fetch(u));
  const team = normalizeTeamDomain(cfg.teamDomain);
  if (!team || !cfg.aud) throw new AccessError('not configured');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessError('malformed');
  const header = b64urlJson(parts[0]);
  if (header.alg !== 'RS256') throw new AccessError('algorithm');
  if (typeof header.kid !== 'string' || !header.kid) throw new AccessError('kid');
  const key = await keyFor(team, header.kid, fetcher, now);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]) as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new AccessError('signature');
  const c = b64urlJson(parts[1]);
  if (c.iss !== `https://${team}`) throw new AccessError('issuer');
  const aud = typeof c.aud === 'string' ? [c.aud] : Array.isArray(c.aud) ? c.aud : [];
  if (!aud.includes(cfg.aud)) throw new AccessError('audience');
  if (typeof c.exp !== 'number' || c.exp + LEEWAY < now) throw new AccessError('expired');
  if (c.nbf != null && (typeof c.nbf !== 'number' || c.nbf - LEEWAY > now)) throw new AccessError('not yet valid');
  if (c.type != null && c.type !== 'app') throw new AccessError('token type');
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) throw new AccessError('no email');
  return { email, exp: c.exp };
}
