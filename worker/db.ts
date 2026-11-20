/** D1 schema (created on first use per isolate) and audit helpers. */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'education', 'admin')),
    added_at TEXT NOT NULL,
    added_by TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL,
    years TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '[]',
    bytes INTEGER NOT NULL,
    chunks INTEGER NOT NULL,
    complete INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL,
    added_by TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dataset_chunks (
    dataset_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (dataset_id, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    email TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  )`,
  'CREATE INDEX IF NOT EXISTS audit_at ON audit (at)',
  'CREATE INDEX IF NOT EXISTS audit_email_action ON audit (email, action, at)',
];

let ready: Promise<unknown> | null = null;

export function ensureSchema(db: D1Database): Promise<unknown> {
  if (!ready) {
    ready = db.batch(SCHEMA.map((s) => db.prepare(s)));
    ready.catch(() => (ready = null));
  }
  return ready;
}

export const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export function audit(db: D1Database, email: string, action: string, detail = ''): D1PreparedStatement {
  return db.prepare('INSERT INTO audit (at, email, action, detail) VALUES (?, ?, ?, ?)').bind(iso(), email, action, detail.slice(0, 500));
}

/** Logs an event unless the same person already has one of this kind within `windowMs`. */
export function auditOnce(db: D1Database, email: string, action: string, windowMs: number, detail = ''): D1PreparedStatement {
  return db
    .prepare('INSERT INTO audit (at, email, action, detail) SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM audit WHERE email = ?2 AND action = ?3 AND at > ?5)')
    .bind(iso(), email, action, detail.slice(0, 500), iso(windowMs));
}
