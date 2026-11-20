/** Recognise an uploaded file and turn it into a dataset ready to publish. */
import { parseRis, slimRecord } from '../lib/ris';
import type { DatasetKind, NewDataset } from '../shared/model';
import { looksLikeCapacity, parseCapacity } from './capacity';
import { looksLikeEcts, parseEcts } from './education';
import { looksLikeAuthorCounts, looksLikeJournals, looksLikeMembers, parseJournals, parseMembers } from './research';
import type { PurePayload } from './types';
import { readXlsx } from './xlsx';

export interface Candidate {
  kind: DatasetKind;
  label: string;
  source: string;
  years: string;
  rows: number;
  notes: string[];
  warnings: string[];
  payload: unknown;
  /** Present for ECTS files that contain names of teachers. */
  personalData?: { field: string; included: boolean };
}

export interface IngestOptions {
  includeTeachers?: boolean;
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/^[0-9a-f]{8}-/, '').replace(/[_]+/g, ' ').trim();

function span(nums: (number | string | null | undefined)[]): string {
  const ys = nums.map((y) => Number(String(y ?? '').slice(0, 4))).filter((y) => y > 1900 && y < 2200);
  if (!ys.length) return '–';
  const a = Math.min(...ys);
  const b = Math.max(...ys);
  return a === b ? String(a) : `${a}–${b}`;
}

export async function ingestFile(file: File, opts: IngestOptions = {}): Promise<Candidate> {
  const name = file.name;
  if (file.size > 30 * 1024 * 1024) throw new Error(`${name}: groter dan 30 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return ingestBytes(name, bytes, opts);
}

export function ingestBytes(name: string, bytes: Uint8Array, opts: IngestOptions = {}): Candidate {
  if (/\.(ris|txt)$/i.test(name)) {
    const text = new TextDecoder().decode(bytes);
    const records = parseRis(text).map(slimRecord);
    if (!records.length) throw new Error(`${name}: geen RIS-records gevonden.`);
    const payload: PurePayload = { records };
    const types = new Set(records.map((r) => r.M3?.[0] ?? r.TY?.[0]));
    return {
      kind: 'pure', label: baseName(name), source: name, years: span(records.map((r) => r.PY?.[0])), rows: records.length,
      notes: [`${records.length} onderzoeksoutputs, ${types.size} outputtypen`], warnings: [], payload,
    };
  }
  if (!/\.xlsx$/i.test(name)) throw new Error(`${name}: alleen .ris- en .xlsx-bestanden worden ondersteund.`);
  const wb = readXlsx(bytes);
  if (looksLikeEcts(wb)) {
    const { payload, notes } = parseEcts(wb, { includeTeachers: !!opts.includeTeachers });
    const failed = payload.checks.filter((c) => !c.ok);
    return {
      kind: 'ects', label: `ECTS-matrix ${span(payload.years)}`, source: name, years: span(payload.years), rows: payload.courses.length, notes,
      warnings: failed.map((c) => `Controle mislukt: ${c.detail}`), payload,
      personalData: wb.sheets.some((s) => s.rows.slice(0, 5).some((r) => r.some((c) => /docent/i.test(String(c ?? ''))))) ? { field: 'docentnamen', included: !!opts.includeTeachers } : undefined,
    };
  }
  if (looksLikeCapacity(wb)) {
    const { payload, notes } = parseCapacity(wb);
    return { kind: 'capacity', label: `Capaciteitsmodel ${span(payload.years)}`, source: name, years: span(payload.years), rows: payload.courses.length, notes, warnings: [], payload };
  }
  if (looksLikeJournals(wb)) {
    const { payload, notes } = parseJournals(wb);
    return { kind: 'journals', label: `Tijdschriftranking ${span(payload.rows.map((r) => r.year))}`, source: name, years: span(payload.rows.map((r) => r.year)), rows: payload.rows.length, notes, warnings: [], payload };
  }
  if (looksLikeMembers(wb)) {
    const { payload, notes, label } = parseMembers(wb, name);
    return { kind: 'members', label, source: name, years: '–', rows: payload.names.length, notes, warnings: [], payload };
  }
  if (looksLikeAuthorCounts(wb)) {
    throw new Error(`${name}: bevat publicatietellingen per auteur. Die berekent het dashboard zelf uit de Pure-export; dit bestand is niet nodig.`);
  }
  throw new Error(`${name}: bestandstype niet herkend. Ondersteund: Pure-export (.ris), ECTS-matrix, capaciteitsmodel, tijdschriftranking en ledenlijst (.xlsx).`);
}

export function toUpload(c: Candidate): { meta: Omit<NewDataset, 'bytes'>; payload: unknown } {
  return { meta: { kind: c.kind, label: c.label.trim() || c.source, source: c.source, years: c.years, rows: c.rows, notes: c.notes }, payload: c.payload };
}
