/** Filtering and aggregation over a normalised dataset. */
import type { Dataset, Publication } from './model';
import { fold } from './text';
import { CATEGORIES, type CategoryId } from './types';

export interface Filters {
  from: number | null;
  to: number | null;
  cats: CategoryId[];
  person: string | null;
  keyword: string | null;
  venue: string | null; // "j:<key>" journal, "c:<key>" conference, "p:<key>" publisher, "s:<key>" series
  q: string;
}

export const EMPTY_FILTERS: Filters = { from: null, to: null, cats: [], person: null, keyword: null, venue: null, q: '' };

export function venueMatches(p: Publication, venue: string): boolean {
  const [kind, ...rest] = venue.split(':');
  const key = rest.join(':');
  if (kind === 'j') return p.journal?.key === key;
  if (kind === 'c') return p.conference?.key === key;
  if (kind === 'p') return p.publisher?.key === key;
  if (kind === 's') return p.series?.key === key;
  return false;
}

export function venueLabel(ds: Dataset, venue: string): string {
  const [kind, ...rest] = venue.split(':');
  const key = rest.join(':');
  const map = { j: ds.journalLabels, c: ds.conferenceLabels, p: ds.publisherLabels, s: ds.seriesLabels }[kind as 'j'];
  return map?.get(key) ?? key;
}

export function applyFilters(ds: Dataset, f: Filters, opts: { ignoreYears?: boolean } = {}): Publication[] {
  const terms = fold(f.q).split(/\s+/).filter(Boolean);
  const cats = f.cats.length ? new Set(f.cats) : null;
  return ds.pubs.filter((p) => {
    if (!opts.ignoreYears) {
      if (f.from != null && (p.year == null || p.year < f.from)) return false;
      if (f.to != null && (p.year == null || p.year > f.to)) return false;
    }
    if (cats && !cats.has(p.category)) return false;
    if (f.person && !p.authors.includes(f.person)) return false;
    if (f.keyword && !p.keywords.includes(f.keyword)) return false;
    if (f.venue && !venueMatches(p, f.venue)) return false;
    for (const t of terms) if (!p.search.includes(t)) return false;
    return true;
  });
}

/** Year span of the current view (falls back to the dataset span). */
export function viewYears(ds: Dataset, f: Filters): [number, number] {
  return [f.from ?? ds.years.min, f.to ?? ds.years.max];
}

export function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let y = a; y <= b; y++) out.push(y);
  return out;
}

export function countBy<T>(items: T[], key: (t: T) => string | string[] | undefined | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k == null) continue;
    for (const kk of Array.isArray(k) ? k : [k]) if (kk) m.set(kk, (m.get(kk) ?? 0) + 1);
  }
  return m;
}

export function topN(m: Map<string, number>, n: number): [string, number][] {
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

export function perYear(pubs: Publication[], years: number[]): number[] {
  const m = countBy(pubs, (p) => (p.year == null ? null : String(p.year)));
  return years.map((y) => m.get(String(y)) ?? 0);
}

export function perYearByCategory(pubs: Publication[], years: number[]): Record<CategoryId, number[]> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c.id, years.map(() => 0)])) as Record<CategoryId, number[]>;
  const idx = new Map(years.map((y, i) => [y, i]));
  for (const p of pubs) {
    const i = p.year == null ? undefined : idx.get(p.year);
    if (i != null) out[p.category][i]++;
  }
  return out;
}

export interface Kpis {
  total: number;
  journal: number;
  conference: number;
  thesis: number;
  people: number;
  teamSize: number;
}

export function kpis(pubs: Publication[]): Kpis {
  const people = new Set<string>();
  let authorSum = 0;
  let withAuthors = 0;
  const c = { journal: 0, conference: 0, thesis: 0 };
  for (const p of pubs) {
    for (const a of p.authors) people.add(a);
    if (p.authorCount) {
      authorSum += p.authorCount;
      withAuthors++;
    }
    if (p.category === 'journal') c.journal++;
    else if (p.category === 'conference') c.conference++;
    else if (p.category === 'thesis') c.thesis++;
  }
  return { total: pubs.length, ...c, people: people.size, teamSize: withAuthors ? authorSum / withAuthors : 0 };
}

/** The same-length period directly before the selected one, if the data covers it. */
export function previousPeriod(ds: Dataset, f: Filters): [number, number] | null {
  const [a, b] = viewYears(ds, f);
  const len = b - a + 1;
  const pa = a - len;
  const pb = a - 1;
  if (f.from == null || pa < ds.years.min) return null;
  return [pa, pb];
}

export interface PersonStat {
  id: string;
  name: string;
  count: number;
  journal: number;
  conference: number;
  first: number | null;
  last: number | null;
  coauthors: number;
  years: Map<number, number>;
}

export function personStats(ds: Dataset, pubs: Publication[]): PersonStat[] {
  const stats = new Map<string, PersonStat & { co: Set<string> }>();
  for (const p of pubs) {
    for (const a of p.authors) {
      let s = stats.get(a);
      if (!s) {
        s = {
          id: a, name: ds.people.get(a)?.name ?? a, count: 0, journal: 0, conference: 0,
          first: null, last: null, coauthors: 0, years: new Map(), co: new Set(),
        };
        stats.set(a, s);
      }
      s.count++;
      if (p.category === 'journal') s.journal++;
      if (p.category === 'conference') s.conference++;
      if (p.year != null) {
        s.first = s.first == null ? p.year : Math.min(s.first, p.year);
        s.last = s.last == null ? p.year : Math.max(s.last, p.year);
        s.years.set(p.year, (s.years.get(p.year) ?? 0) + 1);
      }
      if (p.authors.length <= 50) for (const b of p.authors) if (b !== a) s.co.add(b);
    }
  }
  return [...stats.values()].map(({ co, ...s }) => ({ ...s, coauthors: co.size }));
}

export function coauthors(pubs: Publication[], person: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pubs) {
    if (!p.authors.includes(person)) continue;
    for (const b of p.authors) if (b !== person) m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

export interface NetworkData {
  nodes: { id: string; count: number }[];
  links: { source: string; target: string; weight: number }[];
}

/** Co-authorship among the n most productive people; huge consortia are skipped. */
export function coauthorNetwork(pubs: Publication[], n: number, maxAuthors = 25): NetworkData {
  const counts = countBy(pubs, (p) => p.authors);
  const top = topN(counts, n);
  const keep = new Set(top.map(([id]) => id));
  const links = new Map<string, number>();
  for (const p of pubs) {
    if (p.authors.length > maxAuthors) continue;
    const as = p.authors.filter((a) => keep.has(a)).sort();
    for (let i = 0; i < as.length; i++)
      for (let j = i + 1; j < as.length; j++) {
        const k = `${as[i]}\u0000${as[j]}`;
        links.set(k, (links.get(k) ?? 0) + 1);
      }
  }
  return {
    nodes: top.map(([id, count]) => ({ id, count })),
    links: [...links].map(([k, weight]) => {
      const [source, target] = k.split('\u0000');
      return { source, target, weight };
    }),
  };
}

export interface TrendRow {
  key: string;
  recent: number;
  earlier: number;
  recentShare: number;
  earlierShare: number;
  change: number; // percentage points
}

/** Topics whose share grew most in the last `window` years of the view. */
export function keywordTrends(pubs: Publication[], to: number, window = 3, minCount = 3): TrendRow[] {
  const recent = pubs.filter((p) => p.year != null && p.year > to - window);
  const earlier = pubs.filter((p) => p.year != null && p.year <= to - window);
  if (!recent.length || !earlier.length) return [];
  const rc = countBy(recent, (p) => p.keywords);
  const ec = countBy(earlier, (p) => p.keywords);
  const rWith = recent.filter((p) => p.keywords.length).length || 1;
  const eWith = earlier.filter((p) => p.keywords.length).length || 1;
  const keys = new Set([...rc.keys(), ...ec.keys()]);
  const rows: TrendRow[] = [];
  for (const key of keys) {
    const r = rc.get(key) ?? 0;
    const e = ec.get(key) ?? 0;
    if (r + e < minCount) continue;
    const recentShare = (r / rWith) * 100;
    const earlierShare = (e / eWith) * 100;
    rows.push({ key, recent: r, earlier: e, recentShare, earlierShare, change: recentShare - earlierShare });
  }
  return rows.sort((a, b) => b.change - a.change);
}

export function teamSizeBuckets(pubs: Publication[]): { label: string; count: number }[] {
  const buckets = [
    { label: '1', test: (n: number) => n === 1 },
    { label: '2', test: (n: number) => n === 2 },
    { label: '3', test: (n: number) => n === 3 },
    { label: '4', test: (n: number) => n === 4 },
    { label: '5', test: (n: number) => n === 5 },
    { label: '6–10', test: (n: number) => n >= 6 && n <= 10 },
    { label: '11+', test: (n: number) => n > 10 },
  ];
  return buckets.map((b) => ({ label: b.label, count: pubs.filter((p) => p.authorCount && b.test(p.authorCount)).length }));
}

export function completeness(pubs: Publication[]) {
  const n = pubs.length || 1;
  const share = (fn: (p: Publication) => boolean) => {
    const c = pubs.filter(fn).length;
    return { count: c, share: c / n };
  };
  return {
    doi: share((p) => !!p.doi),
    abstract: share((p) => !!p.abstract),
    keywords: share((p) => p.keywords.length > 0),
    venue: share((p) => !!p.venue),
    isxn: share((p) => !!p.isxn),
    scopus: share((p) => !!p.scopusUrl || !!p.raw.AN?.some((a) => /scopus/i.test(a))),
    authors: share((p) => p.authors.length > 0),
  };
}

/** Bucket years into periods when the span is too wide for one column per year. */
export function yearBuckets(a: number, b: number, maxCols = 22): { label: string; from: number; to: number }[] {
  const span = b - a + 1;
  if (span <= maxCols) return range(a, b).map((y) => ({ label: String(y), from: y, to: y }));
  const size = span <= maxCols * 2 ? 2 : 5;
  const start = Math.floor(a / size) * size;
  const out: { label: string; from: number; to: number }[] = [];
  for (let y = start; y <= b; y += size) {
    const from = Math.max(y, a);
    const to = Math.min(y + size - 1, b);
    out.push({ label: from === to ? String(from) : `${from}–${String(to).slice(-2)}`, from, to });
  }
  return out;
}
