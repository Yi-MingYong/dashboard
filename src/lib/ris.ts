/**
 * Minimal, robust RIS parser/serializer for Pure research-output exports.
 *
 * A RIS record is a list of `TAG  - value` lines terminated by `ER  -`.
 * Pure writes multi-line values (e.g. "Publisher Copyright:\n© 2026 ..."),
 * so lines that do not start with a tag are appended to the previous value.
 */

export type RawRecord = Record<string, string[]>;

const TAG_LINE = /^([A-Z][A-Z0-9])  -(?: (.*))?$/;

export function parseRis(text: string): RawRecord[] {
  const records: RawRecord[] = [];
  let current: RawRecord | null = null;
  let lastTag: string | null = null;

  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (const line of lines) {
    const m = TAG_LINE.exec(line);
    if (m) {
      const tag = m[1];
      const value = (m[2] ?? '').trim();
      if (tag === 'TY') {
        current = {};
        lastTag = null;
      }
      if (tag === 'ER') {
        if (current) records.push(current);
        current = null;
        lastTag = null;
        continue;
      }
      if (!current) current = {};
      (current[tag] ??= []).push(value);
      lastTag = tag;
    } else if (current && lastTag && line.trim()) {
      const arr = current[lastTag];
      arr[arr.length - 1] = `${arr[arr.length - 1]}\n${line.trim()}`.trim();
    }
  }
  if (current && Object.keys(current).length) records.push(current);
  return records;
}

/** Tags that only duplicate another tag in Pure exports. */
const REDUNDANT: Record<string, string> = { N2: 'AB', Y1: 'PY', U2: 'DO', JF: 'JO' };

/** Drop exact duplicates of other tags to keep the shipped JSON small. */
export function slimRecord(rec: RawRecord): RawRecord {
  const out: RawRecord = {};
  for (const [tag, values] of Object.entries(rec)) {
    const twin = REDUNDANT[tag];
    if (twin && rec[twin] && rec[twin].join('\u0000') === values.join('\u0000')) continue;
    const cleaned = values.map((v) => v.trim()).filter(Boolean);
    if (cleaned.length) out[tag] = cleaned;
  }
  return out;
}

const TAG_ORDER = [
  'TY', 'T1', 'T2', 'AU', 'A2', 'PY', 'Y1', 'Y2', 'N1', 'AB', 'KW', 'UR', 'DO', 'M3', 'JO', 'JF',
  'VL', 'IS', 'SP', 'EP', 'BT', 'T3', 'PB', 'CY', 'SN', 'AN', 'C2', 'M1',
];

export function serializeRis(records: RawRecord[]): string {
  const out: string[] = [];
  for (const rec of records) {
    const tags = [
      ...TAG_ORDER.filter((t) => rec[t]),
      ...Object.keys(rec).filter((t) => !TAG_ORDER.includes(t)),
    ];
    if (!rec.TY) out.push('TY  - GEN');
    for (const tag of tags) {
      for (const v of rec[tag]) out.push(`${tag}  - ${v}`);
    }
    out.push('ER  - ', '');
  }
  return out.join('\n');
}
