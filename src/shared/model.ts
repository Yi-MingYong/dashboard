/** Types, labels and limits shared by the browser app and the Worker API. */

export type Scope = 'research' | 'education';
export type Role = 'viewer' | 'education' | 'admin';

export const ROLES: Role[] = ['viewer', 'education', 'admin'];

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Lezer · onderzoek',
  education: 'Lezer · onderzoek + onderwijs',
  admin: 'Beheerder',
};

export const ROLE_SCOPES: Record<Role, Scope[]> = {
  viewer: ['research'],
  education: ['research', 'education'],
  admin: ['research', 'education'],
};

export type DatasetKind = 'pure' | 'members' | 'journals' | 'ects' | 'capacity';

export const KIND_SCOPE: Record<DatasetKind, Scope> = {
  pure: 'research',
  members: 'research',
  journals: 'research',
  ects: 'education',
  capacity: 'education',
};

export const KIND_LABEL: Record<DatasetKind, string> = {
  pure: 'Pure-export (RIS)',
  members: 'Ledenlijst',
  journals: 'Tijdschriftranking',
  ects: 'ECTS-matrix',
  capacity: 'Capaciteitsmodel',
};

export interface DatasetMeta {
  id: string;
  kind: DatasetKind;
  label: string;
  source: string;
  years: string;
  rows: number;
  addedAt: string;
  notes?: string[];
}

/** What the API lists: metadata plus how the stored payload is split. */
export interface DatasetInfo extends DatasetMeta {
  addedBy: string;
  bytes: number;
  chunks: number;
}

export interface PlainDataset<P = unknown> {
  meta: DatasetMeta;
  payload: P;
}

/** Metadata the client sends when publishing; id and timestamps are set by the server. */
export interface NewDataset {
  kind: DatasetKind;
  label: string;
  source: string;
  years: string;
  rows: number;
  notes: string[];
  bytes: number;
}

export interface Me {
  email: string;
  name: string;
  role: Role;
  scopes: Scope[];
  bootstrap: boolean;
  admins: string[];
  allowedDomains: string[];
  seats: number;
}

export interface UserRow {
  email: string;
  name: string;
  role: Role;
  addedAt: string | null;
  addedBy: string | null;
  bootstrap: boolean;
}

export interface AccessRequest {
  email: string;
  at: string;
}

export interface AuditEvent {
  id: number;
  at: string;
  email: string;
  action: string;
  detail: string;
}

export const LIMITS = {
  /** Characters of base64 per stored row and per upload request. */
  chunk: 1_000_000,
  /** Maximum size of one encoded dataset. */
  total: 25_000_000,
  label: 200,
  source: 300,
  years: 20,
  notes: 50,
  note: 300,
  name: 120,
  /** Cloudflare Zero Trust Free plan. */
  seats: 50,
};

export const EMAIL_RE = /^[^\s@<>()",;:]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Exact domain match: subdomains such as student.tue.nl are deliberately not included. */
export function emailAllowed(email: string, domains: string[]): boolean {
  return domains.includes(email.split('@')[1]?.toLowerCase() ?? '');
}

export const splitList = (s: string | undefined) => (s ?? '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
