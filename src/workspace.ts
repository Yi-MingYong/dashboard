/** Combine the published datasets into what the views need. */
import aliasFile from '../data/aliases.json';
import { buildDataset, type Dataset } from './lib/model';
import { parseName } from './lib/names';
import { journalRef } from './lib/venues';
import type { RawRecord } from './lib/ris';
import type { CapacityPayload, EctsPayload, JournalRank, JournalsPayload, MembersPayload, PurePayload } from './ingest/types';
import type { PlainDataset } from './shared/model';

export interface ManifestEntry {
  id: string;
  label: string;
  description?: string;
  source: string;
  records: number;
  yearMin: number | null;
  yearMax: number | null;
  imported?: boolean;
}

export interface Workspace {
  entries: ManifestEntry[];
  pure: Map<string, { meta: PlainDataset['meta']; records: RawRecord[] }>;
  members: { group: string; names: string[] } | null;
  journals: JournalRank[];
  ects: EctsPayload | null;
  capacity: CapacityPayload | null;
  all: PlainDataset[];
}

const aliases: Record<string, string> = (aliasFile as { aliases?: Record<string, string> }).aliases ?? {};
const newest = (ds: PlainDataset[]) => [...ds].sort((a, b) => b.meta.addedAt.localeCompare(a.meta.addedAt));

export function buildWorkspace(datasets: PlainDataset[]): Workspace {
  const pure = new Map<string, { meta: PlainDataset['meta']; records: RawRecord[] }>();
  const entries: ManifestEntry[] = [];
  for (const d of newest(datasets.filter((d) => d.meta.kind === 'pure'))) {
    const records = (d.payload as PurePayload).records;
    pure.set(d.meta.id, { meta: d.meta, records });
    const ys = d.meta.years.split('–').map(Number).filter(Boolean);
    entries.push({ id: d.meta.id, label: d.meta.label, source: d.meta.source, records: records.length, yearMin: ys[0] ?? null, yearMax: ys[ys.length - 1] ?? null });
  }
  const mem = newest(datasets.filter((d) => d.meta.kind === 'members')).map((d) => d.payload as MembersPayload);
  const members = mem.length ? { group: mem[0].group, names: [...new Set(mem.flatMap((m) => m.names))] } : null;
  // Journal rankings: newest upload wins per journal+year.
  const seen = new Set<string>();
  const journals: JournalRank[] = [];
  for (const d of newest(datasets.filter((d) => d.meta.kind === 'journals')))
    for (const r of (d.payload as JournalsPayload).rows) {
      const k = `${journalRef(r.journal)?.key}|${r.year}`;
      if (!seen.has(k)) {
        seen.add(k);
        journals.push(r);
      }
    }
  // ECTS: newest file is the base; years only present in older files are added.
  const ectsList = newest(datasets.filter((d) => d.meta.kind === 'ects')).map((d) => d.payload as EctsPayload);
  let ects: EctsPayload | null = null;
  if (ectsList.length) {
    ects = structuredClone(ectsList[0]);
    for (const older of ectsList.slice(1)) {
      const extra = older.years.filter((y) => !ects!.years.includes(y));
      if (!extra.length) continue;
      const byKey = new Map(ects.courses.map((c) => [`${c.code}|${c.group}`, c]));
      for (const c of older.courses) {
        const target = byKey.get(`${c.code}|${c.group}`);
        if (target) for (const y of extra) target.years[y] = c.years[y];
        else ects.courses.push({ ...c, years: Object.fromEntries(extra.map((y) => [y, c.years[y]])) });
      }
      ects.years = [...ects.years, ...extra].sort();
    }
  }
  const capacity = (newest(datasets.filter((d) => d.meta.kind === 'capacity'))[0]?.payload as CapacityPayload | undefined) ?? null;
  return { entries, pure, members, journals, ects, capacity, all: datasets };
}

const cache = new Map<string, Dataset>();
export function datasetFor(ws: Workspace, id: string): Dataset | null {
  const p = ws.pure.get(id);
  if (!p) return null;
  const key = `${id}|${p.meta.addedAt}`;
  let ds = cache.get(key);
  if (!ds) {
    ds = buildDataset({ id, label: p.meta.label, source: p.meta.source, generatedAt: p.meta.addedAt }, p.records, aliases);
    cache.set(key, ds);
  }
  return ds;
}

/** Person ids in a dataset that match the member list (surname + first name or initial). */
export function memberIds(ds: Dataset, names: string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!names?.length) return out;
  const keys = new Set<string>();
  for (const n of names) {
    const p = parseName(n);
    keys.add(`${p.surnameKey}|${p.firstName || p.initials[0]?.toLowerCase()}`);
    keys.add(`${p.surnameKey}|${p.initials[0]?.toLowerCase()}`);
  }
  for (const person of ds.people.values()) {
    for (const raw of person.variants.keys()) {
      const p = parseName(raw);
      if (keys.has(`${p.surnameKey}|${p.firstName}`) || (!p.firstName && keys.has(`${p.surnameKey}|${p.initials[0]?.toLowerCase()}`))) {
        out.add(person.id);
        break;
      }
    }
  }
  return out;
}

export function journalQuartile(ws: Workspace | null, journalKey: string | undefined, year: number | null): JournalRank | null {
  if (!ws || !journalKey || !ws.journals.length) return null;
  const rows = ws.journals.filter((r) => journalRef(r.journal)?.key === journalKey);
  if (!rows.length) return null;
  return rows.sort((a, b) => Math.abs((a.year ?? 0) - (year ?? 0)) - Math.abs((b.year ?? 0) - (year ?? 0)))[0];
}
