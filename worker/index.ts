/**
 * API for the dashboard. Static files are served by Workers static assets; only /api/*
 * reaches this code (assets.run_worker_first). Every request is checked here:
 * Cloudflare Access token → person on the access list → role → dataset scope.
 */
import { KIND_LABEL, KIND_SCOPE, LIMITS, ROLE_SCOPES, splitList, type DatasetInfo, type DatasetKind, type Me, type Role, type UserRow } from '../src/shared/model';
import { AccessError, normalizeTeamDomain, peekToken, verifyAccessToken } from './access';
import { audit, auditOnce, DAY, ensureSchema, iso, MINUTE } from './db';
import { checkExternal, chunkCount, HttpError, parseEmail, parseName, parseNewDataset, parseRole, validPart } from './rules';

export interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
  ALLOWED_DOMAINS?: string;
  /** Local development only (.dev.vars); ignored unless the request is for localhost. */
  DEV_ACCESS_EMAIL?: string;
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
const plain = (body: string) => new Response(body, { headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });

interface Principal {
  email: string;
  name: string;
  role: Role;
  bootstrap: boolean;
}

interface Ctx {
  req: Request;
  url: URL;
  env: Env;
  exec: ExecutionContext;
  db: D1Database;
  me: Principal;
  admins: string[];
  domains: string[];
}

type Handler = (c: Ctx, m: RegExpMatchArray) => Promise<Response>;

interface DatasetRow {
  id: string;
  kind: DatasetKind;
  label: string;
  source: string;
  years: string;
  row_count: number;
  notes: string;
  bytes: number;
  chunks: number;
  added_at: string;
  added_by: string;
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

async function identify(req: Request, url: URL, env: Env): Promise<string> {
  if (env.DEV_ACCESS_EMAIL && LOCAL.has(url.hostname)) return env.DEV_ACCESS_EMAIL.trim().toLowerCase();
  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const aud = (env.ACCESS_AUD ?? '').trim();
  if (!teamDomain || !aud) {
    const seen = peekToken(token);
    throw new HttpError(503, {
      error: 'setup',
      teamDomain: seen.iss ? normalizeTeamDomain(seen.iss) : null,
      aud: seen.aud?.[0] ?? null,
      email: seen.email ?? null,
      configured: { teamDomain: !!teamDomain, aud: !!aud, admins: splitList(env.ADMIN_EMAILS).length > 0 },
    });
  }
  if (!token) throw new HttpError(401, { error: 'login' });
  try {
    return (await verifyAccessToken(token, { teamDomain, aud })).email;
  } catch (e) {
    if (!(e instanceof AccessError)) throw e;
    console.warn(`Access token rejected: ${e.message}`);
    throw new HttpError(401, { error: 'login' });
  }
}

/** Cross-site requests carry the Access cookie too, so writes must prove they come from this origin. */
function checkWrite(req: Request, url: URL): void {
  const site = req.headers.get('Sec-Fetch-Site');
  const type = req.headers.get('Content-Type') ?? '';
  if (req.headers.get('Origin') !== url.origin || (site && site !== 'same-origin') || !/^application\/json\b/i.test(type)) {
    throw new HttpError(403, { error: 'csrf' });
  }
}

async function readJson(req: Request, max: number): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('Content-Length') ?? 0) > max) throw new HttpError(413, { error: 'too-large' });
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, { error: 'too-large' });
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, { error: 'invalid', field: 'body' });
}

async function principal(db: D1Database, email: string, admins: string[]): Promise<Principal | null> {
  const row = await db.prepare('SELECT name, role FROM users WHERE email = ?').bind(email).first<{ name: string; role: Role }>();
  if (admins.includes(email)) return { email, name: row?.name || email, role: 'admin', bootstrap: true };
  return row ? { email, name: row.name, role: row.role, bootstrap: false } : null;
}

const toInfo = (d: DatasetRow): DatasetInfo => ({
  id: d.id, kind: d.kind, label: d.label, source: d.source, years: d.years, rows: d.row_count,
  notes: JSON.parse(d.notes || '[]'), addedAt: d.added_at, addedBy: d.added_by, bytes: d.bytes, chunks: d.chunks,
});

const canRead = (me: Principal, kind: DatasetKind) => ROLE_SCOPES[me.role].includes(KIND_SCOPE[kind]);

function pathEmail(raw: string): string {
  let e: string;
  try {
    e = decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    throw new HttpError(400, { error: 'invalid', field: 'email' });
  }
  return parseEmail(e);
}

const getMe: Handler = async (c) => {
  c.exec.waitUntil(auditOnce(c.db, c.me.email, 'view', 10 * MINUTE).run().catch(() => undefined));
  const me: Me = {
    email: c.me.email, name: c.me.name, role: c.me.role, scopes: ROLE_SCOPES[c.me.role], bootstrap: c.me.bootstrap,
    admins: c.admins, allowedDomains: c.domains, seats: LIMITS.seats,
  };
  return json(200, me);
};

const listDatasets: Handler = async (c) => {
  const { results } = await c.db
    .prepare('SELECT id, kind, label, source, years, row_count, notes, bytes, chunks, added_at, added_by FROM datasets WHERE complete = 1 ORDER BY added_at DESC')
    .all<DatasetRow>();
  return json(200, { datasets: results.filter((d) => d.kind in KIND_SCOPE && canRead(c.me, d.kind)).map(toInfo) });
};

const getPart: Handler = async (c, m) => {
  const row = await c.db
    .prepare('SELECT d.kind AS kind, p.body AS body FROM dataset_chunks p JOIN datasets d ON d.id = p.dataset_id WHERE p.dataset_id = ? AND p.idx = ? AND d.complete = 1')
    .bind(m[1], Number(m[2]))
    .first<{ kind: DatasetKind; body: string }>();
  if (!row || !canRead(c.me, row.kind)) throw new HttpError(404, { error: 'not-found' });
  return plain(row.body);
};

const createDataset: Handler = async (c) => {
  const d = parseNewDataset(await readJson(c.req, 64 * 1024));
  const rand = [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const id = `${d.kind}-${Date.now().toString(36)}${rand}`;
  const chunks = chunkCount(d.bytes);
  const stale = iso(DAY);
  await c.db.batch([
    c.db.prepare('DELETE FROM dataset_chunks WHERE dataset_id IN (SELECT id FROM datasets WHERE complete = 0 AND added_at < ?)').bind(stale),
    c.db.prepare('DELETE FROM datasets WHERE complete = 0 AND added_at < ?').bind(stale),
    c.db
      .prepare('INSERT INTO datasets (id, kind, label, source, years, row_count, notes, bytes, chunks, complete, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(id, d.kind, d.label, d.source, d.years, d.rows, JSON.stringify(d.notes), d.bytes, chunks, iso(), c.me.email),
  ]);
  return json(201, { id, chunks, chunkSize: LIMITS.chunk });
};

const putPart: Handler = async (c, m) => {
  const [, id, idxRaw] = m;
  const idx = Number(idxRaw);
  const d = await c.db.prepare('SELECT kind, label, bytes, complete FROM datasets WHERE id = ?').bind(id).first<{ kind: DatasetKind; label: string; bytes: number; complete: number }>();
  if (!d) throw new HttpError(404, { error: 'not-found' });
  if (d.complete) throw new HttpError(409, { error: 'complete' });
  const body = await readJson(c.req, LIMITS.chunk + 1024);
  if (!validPart(body.data, d.bytes, idx)) throw new HttpError(400, { error: 'invalid', field: 'data' });
  const data = body.data as string;
  const res = await c.db.batch<{ complete: number }>([
    c.db.prepare('INSERT OR REPLACE INTO dataset_chunks (dataset_id, idx, body) VALUES (?, ?, ?)').bind(id, idx, data),
    c.db.prepare('UPDATE datasets SET complete = 1 WHERE id = ?1 AND complete = 0 AND (SELECT count(*) FROM dataset_chunks WHERE dataset_id = ?1) = chunks').bind(id),
    c.db.prepare('SELECT complete FROM datasets WHERE id = ?').bind(id),
  ]);
  const complete = res[2].results[0]?.complete === 1;
  if (complete) await audit(c.db, c.me.email, 'dataset.add', `${d.label} · ${KIND_LABEL[d.kind]}`).run();
  return json(200, { complete });
};

const deleteDataset: Handler = async (c, m) => {
  const d = await c.db.prepare('SELECT kind, label, complete FROM datasets WHERE id = ?').bind(m[1]).first<{ kind: DatasetKind; label: string; complete: number }>();
  if (!d) throw new HttpError(404, { error: 'not-found' });
  await c.db.batch([
    c.db.prepare('DELETE FROM dataset_chunks WHERE dataset_id = ?').bind(m[1]),
    c.db.prepare('DELETE FROM datasets WHERE id = ?').bind(m[1]),
    ...(d.complete ? [audit(c.db, c.me.email, 'dataset.delete', `${d.label} · ${KIND_LABEL[d.kind]}`)] : []),
  ]);
  return json(200, { ok: true });
};

const listUsers: Handler = async (c) => {
  const [u, r] = await c.db.batch([
    c.db.prepare('SELECT email, name, role, added_at, added_by FROM users ORDER BY name COLLATE NOCASE'),
    c.db.prepare("SELECT email, max(at) AS at FROM audit WHERE action = 'denied' AND at > ? GROUP BY email ORDER BY at DESC LIMIT 50").bind(iso(30 * DAY)),
  ]);
  const rows = u.results as { email: string; name: string; role: Role; added_at: string; added_by: string }[];
  const users: UserRow[] = rows.map((x) => ({
    email: x.email, name: x.name, role: c.admins.includes(x.email) ? 'admin' : x.role, addedAt: x.added_at, addedBy: x.added_by, bootstrap: c.admins.includes(x.email),
  }));
  for (const a of [...c.admins].reverse()) if (!users.some((x) => x.email === a)) users.unshift({ email: a, name: a, role: 'admin', addedAt: null, addedBy: null, bootstrap: true });
  const known = new Set(users.map((x) => x.email));
  return json(200, { users, requests: (r.results as { email: string; at: string }[]).filter((x) => !known.has(x.email)), seats: LIMITS.seats });
};

const putUser: Handler = async (c, m) => {
  const email = pathEmail(m[1]);
  const body = await readJson(c.req, 4096);
  const name = parseName(body.name);
  const bootstrap = c.admins.includes(email);
  const role: Role = bootstrap ? 'admin' : parseRole(body.role);
  const external = checkExternal(email, c.domains, c.admins, body.external);
  if (email === c.me.email && role !== c.me.role) throw new HttpError(400, { error: 'self' });
  const { results } = await c.db.prepare('SELECT email FROM users').all<{ email: string }>();
  const exists = results.some((x) => x.email === email);
  if (!exists && !bootstrap && new Set([...results.map((x) => x.email), ...c.admins]).size >= LIMITS.seats) {
    throw new HttpError(409, { error: 'seats', seats: LIMITS.seats });
  }
  await c.db.batch([
    c.db
      .prepare('INSERT INTO users (email, name, role, added_at, added_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET name = excluded.name, role = excluded.role')
      .bind(email, name, role, iso(), c.me.email),
    audit(c.db, c.me.email, exists ? 'user.update' : 'user.add', `${email} · ${role}${external ? ' · extern adres, bevestigd' : ''}`),
  ]);
  return json(200, { ok: true });
};

const deleteUser: Handler = async (c, m) => {
  const email = pathEmail(m[1]);
  if (c.admins.includes(email)) throw new HttpError(400, { error: 'bootstrap' });
  if (email === c.me.email) throw new HttpError(400, { error: 'self' });
  const row = await c.db.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!row) throw new HttpError(404, { error: 'not-found' });
  await c.db.batch([c.db.prepare('DELETE FROM users WHERE email = ?').bind(email), audit(c.db, c.me.email, 'user.remove', email)]);
  return json(200, { ok: true });
};

const listAudit: Handler = async (c) => {
  const [, ev] = await c.db.batch([
    c.db.prepare('DELETE FROM audit WHERE at < ?').bind(iso(365 * DAY)),
    c.db.prepare('SELECT id, at, email, action, detail FROM audit ORDER BY id DESC LIMIT 500'),
  ]);
  return json(200, { events: ev.results });
};

const ID = '([a-z]+-[a-z0-9]{6,40})';
const ROUTES: [method: string, path: RegExp, handler: Handler, admin: boolean][] = [
  ['GET', /^\/api\/me$/, getMe, false],
  ['GET', /^\/api\/datasets$/, listDatasets, false],
  ['GET', new RegExp(`^/api/datasets/${ID}/parts/(\\d{1,3})$`), getPart, false],
  ['POST', /^\/api\/admin\/datasets$/, createDataset, true],
  ['PUT', new RegExp(`^/api/admin/datasets/${ID}/parts/(\\d{1,3})$`), putPart, true],
  ['DELETE', new RegExp(`^/api/admin/datasets/${ID}$`), deleteDataset, true],
  ['GET', /^\/api\/admin\/users$/, listUsers, true],
  ['PUT', /^\/api\/admin\/users\/([^/]{3,250})$/, putUser, true],
  ['DELETE', /^\/api\/admin\/users\/([^/]{3,250})$/, deleteUser, true],
  ['GET', /^\/api\/admin\/audit$/, listAudit, true],
];

async function handle(req: Request, url: URL, env: Env, exec: ExecutionContext): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  const matches = ROUTES.filter(([, re]) => re.test(path));
  const route = matches.find(([method]) => method === req.method);
  if (!matches.length) throw new HttpError(404, { error: 'not-found' });
  if (!route) throw new HttpError(405, { error: 'method' });
  if (req.method !== 'GET') checkWrite(req, url);

  const email = await identify(req, url, env);
  const admins = splitList(env.ADMIN_EMAILS);
  if (!admins.length) {
    throw new HttpError(503, { error: 'setup', teamDomain: null, aud: null, email, configured: { teamDomain: true, aud: true, admins: false } });
  }
  const db = env.DB;
  await ensureSchema(db);
  const me = await principal(db, email, admins);
  if (!me) {
    exec.waitUntil(auditOnce(db, email, 'denied', 60 * MINUTE, `${req.method} ${path}`).run().catch(() => undefined));
    throw new HttpError(403, { error: 'no-access', email, admins });
  }
  if (route[3] && me.role !== 'admin') throw new HttpError(403, { error: 'forbidden' });
  return route[2]({ req, url, env, exec, db, me, admins, domains: splitList(env.ALLOWED_DOMAINS) }, path.match(route[1])!);
}

export default {
  async fetch(req, env, exec): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: HEADERS });
    try {
      return await handle(req, url, env, exec);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, e.body);
      console.error(e);
      return json(500, { error: 'server' });
    }
  },
} satisfies ExportedHandler<Env>;
