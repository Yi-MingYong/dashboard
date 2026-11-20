/** Input validation for the API. Pure functions, so they can be unit-tested in Node. */
import { EMAIL_RE, emailAllowed, KIND_SCOPE, LIMITS, ROLES, type DatasetKind, type NewDataset, type Role } from '../src/shared/model';

export class HttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error));
  }
}

const bad = (field: string) => new HttpError(400, { error: 'invalid', field });

function str(v: unknown, field: string, max: number, min = 1): string {
  if (typeof v !== 'string') throw bad(field);
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (s.length < min || s.length > max) throw bad(field);
  return s;
}

export function parseNewDataset(v: unknown): NewDataset {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !(o.kind in KIND_SCOPE)) throw bad('kind');
  if (!Number.isInteger(o.rows) || (o.rows as number) < 0 || (o.rows as number) > 10_000_000) throw bad('rows');
  if (!Number.isInteger(o.bytes) || (o.bytes as number) < 4 || (o.bytes as number) % 4) throw bad('bytes');
  if ((o.bytes as number) > LIMITS.total) throw new HttpError(413, { error: 'too-large', max: LIMITS.total });
  const notes = o.notes ?? [];
  if (!Array.isArray(notes) || notes.length > LIMITS.notes) throw bad('notes');
  return {
    kind: o.kind as DatasetKind,
    label: str(o.label, 'label', LIMITS.label),
    source: str(o.source, 'source', LIMITS.source),
    years: str(o.years, 'years', LIMITS.years),
    rows: o.rows as number,
    notes: notes.map((n) => str(n, 'notes', LIMITS.note)),
    bytes: o.bytes as number,
  };
}

export const chunkCount = (bytes: number) => Math.max(1, Math.ceil(bytes / LIMITS.chunk));

/** Expected length of part `idx`: every part is full except possibly the last. */
export function partLength(bytes: number, idx: number): number {
  const n = chunkCount(bytes);
  if (!Number.isInteger(idx) || idx < 0 || idx >= n) return -1;
  return idx < n - 1 ? LIMITS.chunk : bytes - LIMITS.chunk * (n - 1);
}

/** Cheap base64 check (a negated character class is ~7× faster than an anchored pattern). */
export function validPart(s: unknown, bytes: number, idx: number): boolean {
  if (typeof s !== 'string' || s.length !== partLength(bytes, idx)) return false;
  if (/[^A-Za-z0-9+/=]/.test(s)) return false;
  const eq = s.indexOf('=');
  return eq === -1 || (idx === chunkCount(bytes) - 1 && eq >= s.length - 2 && /^=+$/.test(s.slice(eq)));
}

export function parseEmail(v: unknown): string {
  if (typeof v !== 'string') throw bad('email');
  const e = v.trim().toLowerCase();
  if (e.length > 200 || !EMAIL_RE.test(e)) throw bad('email');
  return e;
}

/** Addresses outside the trusted domains may be added, but only with an explicit confirmation from the admin. */
export function checkExternal(email: string, domains: string[], admins: string[], confirmed: unknown): boolean {
  const external = !emailAllowed(email, domains) && !admins.includes(email);
  if (external && confirmed !== true) throw new HttpError(400, { error: 'external', domains });
  return external;
}

export function parseRole(v: unknown): Role {
  if (typeof v !== 'string' || !ROLES.includes(v as Role)) throw bad('role');
  return v as Role;
}

export const parseName = (v: unknown) => str(v, 'name', LIMITS.name);
