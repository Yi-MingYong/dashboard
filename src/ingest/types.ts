/** Normalised payloads as published to the dashboard. */
import type { RawRecord } from '../lib/ris';

export interface PurePayload {
  records: RawRecord[];
}

export interface MembersPayload {
  group: string;
  names: string[];
}

export interface JournalRank {
  journal: string;
  year: number | null;
  rank: string | null;
  quartile: string | null; // "Q1".."Q4"
  percentile: number | null;
  categories: string[];
}

export interface JournalsPayload {
  rows: JournalRank[];
}

/* ───────────── ECTS matrix ───────────── */

export interface EctsYear {
  enroll: number | null;
  passed: number | null;
  ects: number | null;
  other: number | null; // ECTS not attributed to IE&IS
  ieis: number | null; // ECTS attributed to IE&IS (this group's share)
}

export interface EctsCourse {
  code: string;
  name: string;
  type: string;
  quartile: string;
  semester: string;
  sp: number | null;
  school: string;
  group: string;
  share: number | null; // percentage 0–100
  teacher?: string;
  years: Record<string, EctsYear>;
  remarks: Record<string, string>;
}

export interface EctsProject {
  section: string;
  code: string;
  year: string;
  name: string;
  type: string;
  coordinator: string;
  ects: number | null;
  passed: number | null;
  shares: Record<string, number>; // fraction 0–1 per group
  comment: string;
}

export interface EctsChange {
  code: string;
  name: string;
  status: string;
  blocks: { year: string; allocations: { group: string; pct: number | null }[]; approved: string }[];
  remark: string;
}

export interface EnrollmentSnapshot {
  date: string | null;
  label: string;
  programs: string[];
  cohorts: { cohort: string; values: (number | null)[] }[];
  total: (number | null)[];
}

export interface SmallTable {
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export interface EctsPayload {
  sheet: string;
  years: number[];
  courses: EctsCourse[];
  projects: EctsProject[];
  changes: EctsChange[];
  enrollment: EnrollmentSnapshot[];
  bep: SmallTable | null;
  checks: Check[];
  teacherNames: boolean;
}

/* ───────────── capacity model ───────────── */

export interface CapacityCourse {
  code: string;
  name: string;
  share: number | null; // "our percentage"
  driver: string;
  factor: number | null; // "percentage" multiplier on the driver
  values: Record<string, Record<string, number | null>>; // group ("enrollment"/"hours"/…) → AY → value
}

export interface CapacitySection {
  title: string;
  groups: string[];
  rows: { label: string; values: Record<string, Record<string, number | null>> }[];
}

export interface CapacityPayload {
  years: string[]; // academic years "2025/2026"
  assumptions: { label: string; value: number | null; text: string }[];
  cohorts: { years: string[]; series: { label: string; values: (number | null)[] }[] };
  courseGroups: string[];
  courses: CapacityCourse[];
  sections: CapacitySection[];
  notes: string[];
}
