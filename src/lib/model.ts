/** Turn raw RIS records into a normalised, analysable dataset. */
import { buildPeople, type Person } from './names';
import type { RawRecord } from './ris';
import { bestVariant, bump, collapse, fold, foldKey } from './text';
import { classifyType, type CategoryId } from './types';
import { conferenceRef, journalRef, publisherRef, seriesRef, type VenueRef } from './venues';

export interface Publication {
  idx: number;
  title: string;
  subtitle?: string;
  year: number | null;
  date?: string;
  sortDate: string; // "YYYY-MM-DD", unknown parts as 00
  type: string;
  rawType: string;
  category: CategoryId;
  authors: string[]; // person ids, in author order
  authorCount: number;
  editors: string[];
  journal?: VenueRef;
  conference?: VenueRef;
  book?: string;
  series?: VenueRef;
  publisher?: VenueRef;
  venue?: string; // human-readable venue for tables
  doi?: string;
  url?: string;
  scopusUrl?: string;
  keywords: string[]; // keyword keys
  abstract?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  isxn?: string;
  place?: string;
  note?: string;
  search: string;
  raw: RawRecord;
}

export interface PersonEntry extends Person {
  count: number;
}

export interface DatasetMeta {
  id: string;
  label: string;
  description?: string;
  source: string;
  generatedAt?: string;
  records?: number;
  imported?: boolean;
}

export interface Dataset {
  meta: DatasetMeta;
  pubs: Publication[];
  people: Map<string, PersonEntry>;
  keywordLabels: Map<string, string>;
  journalLabels: Map<string, string>;
  conferenceLabels: Map<string, string>;
  publisherLabels: Map<string, string>;
  seriesLabels: Map<string, string>;
  years: { min: number; max: number };
  mergedNames: number;
}

const first = (r: RawRecord, tag: string) => r[tag]?.[0]?.trim() || undefined;

function sortableDate(py: string | undefined): string {
  const m = py && /(\d{4})(?:[/-](\d{1,2}))?(?:[/-](\d{1,2}))?/.exec(py);
  if (!m) return '0000-00-00';
  return `${m[1]}-${(m[2] ?? '0').padStart(2, '0')}-${(m[3] ?? '0').padStart(2, '0')}`;
}

function parseYear(py: string | undefined): number | null {
  const m = py && /(\d{4})/.exec(py);
  return m ? Number(m[1]) : null;
}

/** Pure writes old event metadata as "conference; OTM 2007, Vilamoura; 2007-11-25; ...". */
function cleanEvent(t2: string): string {
  let s = collapse(t2);
  if (/^(conference|congres|workshop|symposium)\s*;/i.test(s)) s = s.replace(/^[^;]*;\s*/, '').split(';')[0];
  return s.trim();
}

function normalizeDoi(doi: string | undefined): string | undefined {
  if (!doi) return undefined;
  const d = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return /^10\.\S+\/\S+/.test(d) ? d : undefined;
}

/** arXiv subject classes ("cs.LG") and MeSH check tags carry no topical meaning. */
const KEYWORD_NOISE = new Set([
  'humans', 'human', 'male', 'female', 'adult', 'aged', 'middle aged', 'young adult', 'adolescent', 'child',
  'animals', 'aged 80 and over', 'infant', 'child preschool', 'article', 'priority journal', 'controlled study',
]);

function keywordKey(kw: string): string {
  if (/^[a-z-]{2,10}\.[A-Z]{2}$/.test(kw.trim())) return '';
  const k = foldKey(kw);
  return KEYWORD_NOISE.has(k) ? '' : k;
}

export function buildDataset(
  meta: DatasetMeta,
  records: RawRecord[],
  aliases: Record<string, string> = {},
): Dataset {
  // People first: disambiguation needs all spellings of the dataset.
  const occ = new Map<string, number>();
  for (const r of records) for (const a of r.AU ?? []) if (a.trim()) bump(occ, collapse(a));
  const { byRaw, people } = buildPeople(occ, aliases);

  const kwVariants = new Map<string, Map<string, number>>();
  const venueVariants = {
    journal: new Map<string, Map<string, number>>(),
    conference: new Map<string, Map<string, number>>(),
    publisher: new Map<string, Map<string, number>>(),
    series: new Map<string, Map<string, number>>(),
  };
  const noteVariant = (bucket: Map<string, Map<string, number>>, ref?: VenueRef) => {
    if (!ref) return;
    const m = bucket.get(ref.key) ?? new Map<string, number>();
    bump(m, ref.name);
    bucket.set(ref.key, m);
  };

  const pubs: Publication[] = records.map((r, idx) => {
    const ty = first(r, 'TY');
    const rawType = first(r, 'M3') ?? ty ?? '';
    const { label, category } = classifyType(first(r, 'M3'), ty);
    const t2 = first(r, 'T2');
    const isConfArticle = /conference article/i.test(rawType);
    const t2IsEvent = !!t2 && (['GEN', 'CONF', 'CPAPER'].includes(ty ?? '') || isConfArticle ||
      (ty === 'CHAP' && /^(conference|workshop)\s*;|conference|workshop|symposium/i.test(t2)) ||
      (ty === 'BOOK' && category === 'book' && /conference|workshop|symposium/i.test(t2)));

    const journal = ty === 'JOUR' || category === 'journal' ? journalRef(first(r, 'JO') ?? first(r, 'JF')) : undefined;
    let conference: VenueRef | undefined;
    if (t2IsEvent) conference = conferenceRef(cleanEvent(t2!));
    else if (category === 'conference' && first(r, 'BT')) conference = conferenceRef(first(r, 'BT'));
    const series = seriesRef(first(r, 'T3'));
    const publisher = publisherRef(first(r, 'PB'));
    const bookTitle = first(r, 'BT');
    const title = collapse(first(r, 'T1') ?? first(r, 'TI') ?? '(zonder titel)');
    const book = bookTitle && foldKey(bookTitle) !== foldKey(title) ? collapse(bookTitle) : undefined;

    noteVariant(venueVariants.journal, journal);
    noteVariant(venueVariants.conference, conference);
    noteVariant(venueVariants.publisher, publisher);
    noteVariant(venueVariants.series, series);

    const authorIds: string[] = [];
    for (const a of r.AU ?? []) {
      const id = byRaw.get(collapse(a));
      if (id && !authorIds.includes(id)) authorIds.push(id);
    }

    const keywords: string[] = [];
    for (const kw of r.KW ?? []) {
      const k = keywordKey(kw);
      if (!k || keywords.includes(k)) continue;
      keywords.push(k);
      const m = kwVariants.get(k) ?? new Map<string, number>();
      bump(m, collapse(kw));
      kwVariants.set(k, m);
    }

    const sp = first(r, 'SP');
    const ep = first(r, 'EP');
    const pages = sp && ep && sp !== ep ? `${sp}–${ep}` : sp;
    // Only http(s) links are kept, so imported files cannot inject other URL schemes.
    const urls = (r.UR ?? []).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
    const scopusUrl = urls.find((u) => /^https?:\/\/([^/]*\.)?scopus\.com\//i.test(u));
    const url = urls.find((u) => u !== scopusUrl);
    const doi = normalizeDoi(first(r, 'DO'));
    const abstract = first(r, 'AB') ?? first(r, 'N2');
    const subtitle = t2 && !t2IsEvent ? collapse(t2) : undefined;
    const venue =
      journal?.name ?? (conference ? (t2IsEvent ? cleanEvent(t2!) : conference.name) : undefined) ?? book ??
      (category === 'preprint' || category === 'report' || category === 'thesis' ? publisher?.name : undefined);

    return {
      idx,
      title,
      subtitle,
      year: parseYear(first(r, 'PY') ?? first(r, 'Y1') ?? first(r, 'DA')),
      date: first(r, 'PY'),
      sortDate: sortableDate(first(r, 'PY') ?? first(r, 'Y1')),
      type: label,
      rawType,
      category,
      authors: authorIds,
      authorCount: authorIds.length,
      editors: r.A2 ?? [],
      journal,
      conference,
      book,
      series,
      publisher,
      venue,
      doi,
      url,
      scopusUrl,
      keywords,
      abstract,
      volume: first(r, 'VL'),
      issue: first(r, 'IS'),
      pages,
      isxn: first(r, 'SN'),
      place: first(r, 'CY'),
      note: first(r, 'N1'),
      search: '',
      raw: r,
    };
  });

  // Merge singular/plural keyword variants ("neural network" / "neural networks").
  const kwRedirect = new Map<string, string>();
  for (const k of kwVariants.keys()) {
    if (k.endsWith('s') && kwVariants.has(k.slice(0, -1))) {
      const a = k.slice(0, -1);
      const na = [...kwVariants.get(a)!.values()].reduce((x, y) => x + y, 0);
      const nb = [...kwVariants.get(k)!.values()].reduce((x, y) => x + y, 0);
      if (nb > na) kwRedirect.set(a, k);
      else kwRedirect.set(k, a);
    }
  }
  const keywordLabels = new Map<string, string>();
  for (const [k, variants] of kwVariants) {
    const target = kwRedirect.get(k) ?? k;
    if (target !== k) continue;
    const merged = new Map(variants);
    for (const [from, to] of kwRedirect) if (to === k) for (const [v, n] of kwVariants.get(from)!) bump(merged, v, n);
    keywordLabels.set(k, bestVariant(merged));
  }

  const peopleOut = new Map<string, PersonEntry>();
  for (const [id, p] of people) peopleOut.set(id, { ...p, count: 0 });

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pubs) {
    if (kwRedirect.size) p.keywords = [...new Set(p.keywords.map((k) => kwRedirect.get(k) ?? k))];
    for (const a of p.authors) peopleOut.get(a)!.count++;
    if (p.year) {
      minY = Math.min(minY, p.year);
      maxY = Math.max(maxY, p.year);
    }
    p.search = fold(
      [
        p.title, p.subtitle, p.venue, p.journal?.name, p.conference?.name, p.book, p.doi, p.type,
        ...p.authors.map((a) => peopleOut.get(a)!.name), ...(p.raw.AU ?? []),
        ...p.keywords.map((k) => keywordLabels.get(k)), p.abstract,
      ].filter(Boolean).join(' • '),
    );
  }

  const labels = (bucket: Map<string, Map<string, number>>) => {
    const out = new Map<string, string>();
    for (const [k, v] of bucket) out.set(k, bestVariant(v));
    return out;
  };

  return {
    meta: { ...meta, records: pubs.length },
    pubs,
    people: peopleOut,
    keywordLabels,
    journalLabels: labels(venueVariants.journal),
    conferenceLabels: labels(venueVariants.conference),
    publisherLabels: labels(venueVariants.publisher),
    seriesLabels: labels(venueVariants.series),
    years: { min: Number.isFinite(minY) ? minY : 0, max: Number.isFinite(maxY) ? maxY : 0 },
    mergedNames: occ.size - people.size,
  };
}
