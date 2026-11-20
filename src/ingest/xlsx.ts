/**
 * Minimal, defensive .xlsx reader: unzips with fflate and reads cell values
 * (shared strings, inline strings, numbers, booleans, cached formula results).
 * Nothing is evaluated; macros, external links and formulas are ignored.
 */
import { unzipSync } from 'fflate';

export type Cell = string | number | boolean | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export interface Workbook {
  sheets: Sheet[];
}

const MAX_FILE = 30 * 1024 * 1024; // 30 MB compressed
const MAX_PART = 120 * 1024 * 1024; // 120 MB for a single XML part
const MAX_CELLS = 2_000_000;

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e],
  );
}

function attr(attrs: string, name: string): string | undefined {
  const key = ` ${name}="`;
  const a = ` ${attrs.replace(/[\t\n\r]/g, ' ')}`;
  const i = a.indexOf(key);
  if (i === -1) return undefined;
  const j = a.indexOf('"', i + key.length);
  return j === -1 ? undefined : decodeXml(a.slice(i + key.length, j));
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Text of all <t> runs, ignoring phonetic runs (<rPh>). */
function textRuns(xml: string): string {
  let out = '';
  // Phonetic runs (<rPh>) contain <t> too; drop them first.
  let s = xml;
  for (let i = s.indexOf('<rPh'); i !== -1; i = s.indexOf('<rPh')) {
    const e = s.indexOf('</rPh>', i);
    s = s.slice(0, i) + (e === -1 ? '' : s.slice(e + 6));
  }
  for (const t of elements(s, 't')) out += t.body;
  return decodeXml(out);
}

function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Linear scanner over <tag ...>body</tag> and <tag .../> elements (no backtracking regexes). */
function* elements(xml: string, tag: string): Generator<{ attrs: string; body: string }> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  while ((i = xml.indexOf(open, i)) !== -1) {
    const next = xml.charCodeAt(i + open.length);
    // must be followed by whitespace, ">" or "/" (so <c does not match <cols>)
    if (!(next === 32 || next === 9 || next === 10 || next === 13 || next === 62 || next === 47)) {
      i += open.length;
      continue;
    }
    const end = xml.indexOf('>', i);
    if (end === -1) return;
    if (xml.charCodeAt(end - 1) === 47) {
      yield { attrs: xml.slice(i + open.length, end - 1), body: '' };
      i = end + 1;
      continue;
    }
    const c = xml.indexOf(close, end);
    if (c === -1) return;
    yield { attrs: xml.slice(i + open.length, end), body: xml.slice(end + 1, c) };
    i = c + close.length;
  }
}

export function readXlsx(bytes: Uint8Array): Workbook {
  if (bytes.length > MAX_FILE) throw new Error('Bestand is groter dan 30 MB.');
  if (!isXlsx(bytes)) throw new Error('Dit is geen .xlsx-bestand (oude .xls of CSV wordt niet ondersteund; sla op als Excel-werkmap).');
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      const wanted = /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(f.name);
      if (!wanted) return false;
      if (f.originalSize > MAX_PART) throw new Error('Werkblad is onverwacht groot; bestand geweigerd.');
      total += f.originalSize;
      if (total > MAX_PART * 2) throw new Error('Bestand pakt uit tot meer dan 240 MB; geweigerd.');
      return true;
    },
  });
  const td = new TextDecoder();
  const text = (p: string) => (files[p] ? td.decode(files[p]) : '');

  const shared: string[] = [];
  for (const si of elements(text('xl/sharedStrings.xml'), 'si')) shared.push(textRuns(si.body));

  const rels = new Map<string, string>();
  for (const r of elements(text('xl/_rels/workbook.xml.rels'), 'Relationship')) {
    const id = attr(r.attrs, 'Id');
    const target = attr(r.attrs, 'Target');
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }

  const sheets: Sheet[] = [];
  let cells = 0;
  for (const sh of elements(text('xl/workbook.xml'), 'sheet')) {
    const name = attr(sh.attrs, 'name') ?? `Blad${sheets.length + 1}`;
    const rid = attr(sh.attrs, 'r:id');
    const target = rid ? rels.get(rid) : undefined;
    const xml = target ? text(`xl/${target}`) : '';
    const rows: Cell[][] = [];
    for (const rw of elements(xml, 'row')) {
      const r = Number(attr(rw.attrs, 'r') ?? rows.length + 1) - 1;
      const row: Cell[] = [];
      for (const c of elements(rw.body, 'c')) {
        if (++cells > MAX_CELLS) throw new Error('Te veel cellen in dit bestand.');
        const ref = attr(c.attrs, 'r');
        const col = ref ? colIndex(ref) : row.length;
        const type = attr(c.attrs, 't');
        const vEl = elements(c.body, 'v').next().value;
        const v = vEl ? vEl.body : undefined;
        let value: Cell = null;
        if (type === 's') value = v != null ? shared[Number(v)] ?? null : null;
        else if (type === 'inlineStr') value = textRuns(c.body);
        else if (type === 'str') value = v != null ? decodeXml(v) : null;
        else if (type === 'b') value = v === '1';
        else if (type === 'e') value = null;
        else if (v != null && v !== '') value = Number(v);
        if (typeof value === 'string') value = value.trim() === '' ? null : value;
        if (col >= 0 && col < 16384) row[col] = value;
      }
      if (r >= 0 && r < 1_048_576) rows[r] = Array.from(row, (x) => (x === undefined ? null : x));
    }
    sheets.push({ name, rows: Array.from(rows, (x) => x ?? []) });
  }
  if (!sheets.length) throw new Error('Geen werkbladen gevonden in dit bestand.');
  return { sheets };
}

/* ───────────── helpers for the parsers ───────────── */

export const cellText = (c: Cell | undefined): string => (c == null ? '' : String(c).trim());

export function cellNum(c: Cell | undefined): number | null {
  if (c == null || c === '') return null;
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c === 'boolean') return null;
  const s = c.replace(/\s/g, '').replace(/%$/, '');
  if (!/^-?[\d.,]+$/.test(s)) return null;
  // "1.234,5" (nl) or "1,234.5" (en) or "12,5"
  const norm = /,\d{1,3}$/.test(s) && !/\.\d+,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Excel serial date → ISO date (yyyy-mm-dd). */
export function serialToDate(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.toISOString().slice(0, 10);
}

export function findRow(rows: Cell[][], pred: (row: string[]) => boolean, from = 0): number {
  for (let i = from; i < rows.length; i++) if (pred((rows[i] ?? []).map((c) => norm(cellText(c))))) return i;
  return -1;
}
