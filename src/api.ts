/** Client for the Worker API. The Cloudflare Access session cookie authenticates every call. */
import { decodePayload, encodePayload, splitChunks } from './shared/codec';
import type { AccessRequest, AuditEvent, DatasetInfo, Me, NewDataset, PlainDataset, Role, UserRow } from './shared/model';

export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(errorText(status, body));
  }
  get code(): string {
    return String(this.body.error ?? '');
  }
}

function errorText(status: number, b: Record<string, unknown>): string {
  switch (b.error) {
    case 'login': return 'Je sessie is verlopen. Herlaad de pagina om opnieuw in te loggen.';
    case 'no-access': return 'Je hebt (nog) geen toegang.';
    case 'forbidden': return 'Alleen beheerders mogen dit.';
    case 'setup': return 'Het dashboard is nog niet volledig ingericht.';
    case 'external': return `Dit adres valt buiten ${((b.domains as string[]) ?? []).map((d) => `@${d}`).join(' en ')}; bevestig eerst dat je deze persoon toegang wilt geven.`;
    case 'seats': return `Het maximum van ${b.seats} personen is bereikt (Cloudflare Zero Trust Free). Trek eerst iemands toegang in.`;
    case 'self': return 'Je kunt je eigen rol niet wijzigen of jezelf verwijderen.';
    case 'bootstrap': return 'Deze beheerder staat vast in de configuratie (ADMIN_EMAILS) en kan hier niet worden verwijderd.';
    case 'too-large': return 'Het bestand is te groot om te publiceren.';
    case 'invalid': return `Ongeldige invoer${b.field ? ` (${b.field})` : ''}.`;
    case 'csrf': return 'Verzoek geweigerd (andere herkomst).';
    case 'not-found': return 'Niet gevonden; misschien is het intussen verwijderd.';
    default: return `De server gaf een fout (${status}).`;
  }
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      redirect: 'manual',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  // Cloudflare Access answers with a redirect to its login page once the session has expired.
  if (res.type === 'opaqueredirect' || res.status === 0 || res.status === 401) throw new ApiError(401, { error: 'login' });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return res;
}

const get = async <T>(path: string) => (await call('GET', path)).json() as Promise<T>;
const send = async <T>(method: string, path: string, body: unknown = {}) => (await call(method, path, body)).json() as Promise<T>;

export const api = {
  me: () => get<Me>('/api/me'),
  datasets: async () => (await get<{ datasets: DatasetInfo[] }>('/api/datasets')).datasets,
  users: () => get<{ users: UserRow[]; requests: AccessRequest[]; seats: number }>('/api/admin/users'),
  putUser: (email: string, name: string, role: Role, external = false) => send('PUT', `/api/admin/users/${encodeURIComponent(email)}`, { name, role, external }),
  removeUser: (email: string) => send('DELETE', `/api/admin/users/${encodeURIComponent(email)}`),
  audit: async () => (await get<{ events: AuditEvent[] }>('/api/admin/audit')).events,
  removeDataset: (id: string) => send('DELETE', `/api/admin/datasets/${id}`),
};

const decoded = new Map<string, Promise<PlainDataset>>();

/** Datasets never change once published (a new upload gets a new id), so decoded payloads are cached by id. */
export function loadDataset(d: DatasetInfo): Promise<PlainDataset> {
  let p = decoded.get(d.id);
  if (!p) {
    p = (async () => {
      const parts = await Promise.all(Array.from({ length: d.chunks }, (_, i) => call('GET', `/api/datasets/${d.id}/parts/${i}`).then((r) => r.text())));
      const meta = { id: d.id, kind: d.kind, label: d.label, source: d.source, years: d.years, rows: d.rows, addedAt: d.addedAt, notes: d.notes };
      return { meta, payload: await decodePayload(parts.join('')) };
    })();
    decoded.set(d.id, p);
    p.catch(() => decoded.delete(d.id));
  }
  return p;
}

export async function loadDatasets(list: DatasetInfo[]): Promise<{ datasets: PlainDataset[]; failed: DatasetInfo[] }> {
  const out = await Promise.allSettled(list.map(loadDataset));
  const failed = list.filter((_, i) => out[i].status === 'rejected');
  const login = out.find((r): r is PromiseRejectedResult => r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 401);
  if (login) throw login.reason;
  return { datasets: out.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])), failed };
}

export async function publishDataset(meta: Omit<NewDataset, 'bytes'>, payload: unknown, onProgress?: (done: number, total: number) => void): Promise<string> {
  const data = await encodePayload(payload);
  const { id, chunkSize } = await send<{ id: string; chunks: number; chunkSize: number }>('POST', '/api/admin/datasets', { ...meta, bytes: data.length });
  const parts = splitChunks(data, chunkSize);
  try {
    let complete = false;
    for (let i = 0; i < parts.length; i++) {
      onProgress?.(i, parts.length);
      complete = (await send<{ complete: boolean }>('PUT', `/api/admin/datasets/${id}/parts/${i}`, { data: parts[i] })).complete;
    }
    if (!complete) throw new Error('De upload is niet volledig aangekomen. Probeer het opnieuw.');
    return id;
  } catch (e) {
    await api.removeDataset(id).catch(() => undefined);
    throw e;
  }
}

export const LOGOUT_URL = '/cdn-cgi/access/logout';
