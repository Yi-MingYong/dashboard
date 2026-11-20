/**
 * ECTS matrix parser. Column positions are never assumed: year-bound columns are
 * recognised by name ("Enroll 23", "Def aantal 24", "IEIS 25", "Remark 2025"), and
 * columns without a year ("niet ieis") belong to the year block they sit in. So
 * files for earlier and later years parse the same way.
 */
import { cellNum, cellText, findRow, norm, serialToDate, type Cell, type Sheet, type Workbook } from './xlsx';
import type { Check, EctsChange, EctsCourse, EctsPayload, EctsProject, EctsYear, EnrollmentSnapshot, SmallTable } from './types';

export const IEIS_GROUPS = ['HPM', 'HTI', 'IS', 'ITEM', 'OPAC', 'PH&E', 'TIS'];

export function canonicalGroup(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return 'Onbekend';
  const u = s.toUpperCase();
  if (IEIS_GROUPS.includes(u)) return u;
  if (u === 'F_IE&IS' || u === 'IE&IS') return 'F_IE&IS';
  if (u === 'SCHOOL IS') return 'School IS';
  if (u === 'SCHOOL IE') return 'School IE';
  return s;
}

function yearOf(token: string | undefined): number | null {
  if (!token) return null;
  const n = Number(token);
  if (token.length === 2) return 2000 + n;
  if (token.length === 4 && n > 1990 && n < 2100) return n;
  return null;
}

type Measure = keyof EctsYear;
const MEASURES: [Measure, RegExp][] = [
  ['enroll', /^enrol(?:l|ment|led)?\s*(\d{2}|\d{4})?$/],
  ['passed', /^def\.?\s*aant(?:al)?\.?\s*(\d{2}|\d{4})?$/],
  ['other', /^niet\s*ie\s*&?\s*is\s*(\d{2}|\d{4})?\d?$/],
  ['ieis', /^ie\s*&?\s*is\s*(\d{2}|\d{4})?$/],
  ['ects', /^ects\s*(\d{2}|\d{4})?$/],
];

function isMainSheet(s: Sheet): number {
  return findRow(s.rows.slice(0, 8), (r) => r.includes('vakcode') && r.some((c) => /^ects\s*\d{2,4}$/.test(c)));
}

function parseCourses(sheet: Sheet, h: number, includeTeachers: boolean) {
  const head = (sheet.rows[h] ?? []).map((c) => norm(cellText(c)));
  const idx = (pred: (c: string) => boolean) => head.findIndex(pred);
  const col = {
    quartile: idx((c) => c === 'quartile' || c === 'kwartiel'),
    semester: idx((c) => c === 'semester'),
    code: idx((c) => c === 'vakcode' || c === 'course code'),
    type: idx((c) => c === 'type'),
    name: idx((c) => c === 'vaknaam' || c === 'course name'),
    teacher: idx((c) => c.startsWith('betrokken docent') || c.startsWith('docent')),
    sp: idx((c) => c === 'sp bama' || c === 'sp' || c === 'ects bama'),
    school: idx((c) => c === 'school'),
    group: idx((c) => c === 'groep' || c === 'group'),
    share: idx((c) => c === '%'),
  };
  const yearCols: { col: number; year: number; measure: Measure }[] = [];
  const remarkCols: { col: number; year: number }[] = [];
  let current: number | null = null;
  head.forEach((c, i) => {
    const rm = /^remarks?\s*(\d{4}|\d{2})$/.exec(c);
    if (rm) {
      remarkCols.push({ col: i, year: yearOf(rm[1])! });
      return;
    }
    for (const [measure, re] of MEASURES) {
      const m = re.exec(c);
      if (!m) continue;
      const y = yearOf(m[1]);
      if (y) current = y;
      if (current) yearCols.push({ col: i, year: current, measure });
      return;
    }
  });
  const years = [...new Set(yearCols.map((y) => y.year))].sort();
  const courses: EctsCourse[] = [];
  let skipped = 0;
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const code = cellText(row[col.code]);
    if (!code) {
      if (row.some((c) => c != null)) skipped++;
      continue;
    }
    const yearsData: Record<string, EctsYear> = {};
    for (const y of years) yearsData[y] = { enroll: null, passed: null, ects: null, other: null, ieis: null };
    for (const yc of yearCols) yearsData[yc.year][yc.measure] = cellNum(row[yc.col]);
    const remarks: Record<string, string> = {};
    for (const rc of remarkCols) {
      const t = cellText(row[rc.col]);
      if (t) remarks[rc.year] = t;
    }
    const course: EctsCourse = {
      code,
      name: cellText(row[col.name]),
      type: cellText(row[col.type]),
      quartile: cellText(row[col.quartile]),
      semester: cellText(row[col.semester]),
      sp: cellNum(row[col.sp]),
      school: cellText(row[col.school]),
      group: canonicalGroup(cellText(row[col.group])),
      share: cellNum(row[col.share]),
      years: yearsData,
      remarks,
    };
    const teacher = cellText(row[col.teacher]);
    if (includeTeachers && teacher && norm(teacher) !== 'nvt') course.teacher = teacher;
    courses.push(course);
  }
  return { years, courses, skipped, hasTeacherColumn: col.teacher >= 0 };
}

/** Cross-check our per-group IE&IS sums with the "Totals" pivot sheet, when present. */
function checkTotals(wb: Workbook, courses: EctsCourse[]): Check[] {
  const sheet = wb.sheets.find((s) => /total/i.test(s.name));
  if (!sheet) return [];
  const expected = new Map<number, Map<string, number>>();
  sheet.rows.forEach((row, r) =>
    row.forEach((c, ci) => {
      const m = /^som van ie\s*&?\s*is\s*(\d{2}|\d{4})$/.exec(norm(cellText(c)));
      const y = m && yearOf(m[1]);
      if (!y || expected.has(y)) return;
      const map = new Map<string, number>();
      for (let rr = r + 2; rr < sheet.rows.length; rr++) {
        const label = cellText(sheet.rows[rr]?.[ci]);
        if (!label || /eindtotaal|totaal|total/i.test(label)) break;
        const v = cellNum(sheet.rows[rr]?.[ci + 1]);
        if (v != null) map.set(canonicalGroup(label), (map.get(canonicalGroup(label)) ?? 0) + v);
      }
      if (map.size) expected.set(y, map);
    }),
  );
  const checks: Check[] = [];
  for (const [y, map] of [...expected].sort((a, b) => a[0] - b[0])) {
    const computed = new Map<string, number>();
    for (const c of courses) {
      const v = c.years[y]?.ieis;
      if (v != null) computed.set(c.group, (computed.get(c.group) ?? 0) + v);
    }
    const off = [...map].filter(([g, v]) => Math.abs((computed.get(g) ?? 0) - v) > 0.5);
    checks.push({
      label: `IE&IS-ECTS ${y} per groep`,
      ok: off.length === 0,
      detail: off.length
        ? `Wijkt af van tabblad "${sheet.name}" voor ${off.map(([g, v]) => `${g} (${v.toFixed(1)} vs ${(computed.get(g) ?? 0).toFixed(1)})`).join(', ')}`
        : `${map.size} groepen komen overeen met tabblad "${sheet.name}"`,
    });
  }
  return checks;
}

function parseProjects(wb: Workbook): EctsProject[] {
  const sheet = wb.sheets.find((s) => findRow(s.rows.slice(0, 10), (r) => r.includes('cursus') && r.includes('passed')) >= 0);
  if (!sheet) return [];
  const out: EctsProject[] = [];
  let head: string[] | null = null;
  let section = '';
  let cols: Record<string, number> = {};
  let groupCols: { col: number; group: string }[] = [];
  for (const row of sheet.rows) {
    const n = (row ?? []).map((c) => norm(cellText(c)));
    if (n.includes('cursus') && n.includes('passed')) {
      head = n;
      section = cellText(row[0]) || cellText(row[n.findIndex((c) => c.startsWith('semester'))]) || '';
      const at = (p: (c: string) => boolean) => n.findIndex(p);
      cols = {
        code: at((c) => c === 'cursus'), year: at((c) => c.startsWith('collegejaar') || c === 'academic year'), name: at((c) => c.startsWith('korte naam') || c === 'name'),
        type: at((c) => c.startsWith('cursustype')), coord: at((c) => c.startsWith('coordinerend')), ects: at((c) => c === 'ects'),
        passed: at((c) => c === 'passed'), total: at((c) => c === 'total' || c === 'totaal'), comment: at((c) => c.startsWith('comment') || c.startsWith('opmerking')),
      };
      const end = cols.total >= 0 ? cols.total : n.length;
      groupCols = [];
      for (let i = cols.passed + 1; i < end; i++) if (n[i]) groupCols.push({ col: i, group: canonicalGroup(cellText(row[i])) });
      continue;
    }
    if (!head) continue;
    const code = cellText(row?.[cols.code]);
    if (!code) continue;
    const raw = groupCols.map((g) => ({ g: g.group, v: cellNum(row[g.col]) ?? 0 }));
    const total = cellNum(row[cols.total]) || raw.reduce((a, x) => a + x.v, 0);
    const shares: Record<string, number> = {};
    if (total > 0) for (const x of raw) if (x.v) shares[x.g] = x.v / total;
    out.push({
      section, code, year: cellText(row[cols.year]), name: cellText(row[cols.name]), type: cellText(row[cols.type]),
      coordinator: canonicalGroup(cellText(row[cols.coord])), ects: cellNum(row[cols.ects]), passed: cellNum(row[cols.passed]), shares,
      comment: cellText(row[cols.comment]),
    });
  }
  return out;
}

function parseChanges(wb: Workbook): EctsChange[] {
  const sheet = wb.sheets.find((s) => findRow(s.rows.slice(0, 10), (r) => r.includes('course code') && r.some((c) => c.startsWith('new'))) >= 0);
  if (!sheet) return [];
  const h = findRow(sheet.rows, (r) => r.includes('course code') && r.some((c) => c.startsWith('new')));
  const head = (sheet.rows[h] ?? []).map((c) => norm(cellText(c)));
  const above = sheet.rows[h - 1] ?? [];
  const markers: { col: number; year: string }[] = [];
  above.forEach((c, i) => {
    const m = /(\d{4})/.exec(cellText(c));
    if (m) markers.push({ col: i, year: m[1] });
  });
  const blocks = markers.map((m, i) => {
    const end = markers[i + 1]?.col ?? head.length;
    const pairs: { g: number; p: number }[] = [];
    let approved = -1;
    for (let c = m.col; c < end; c++) {
      if (head[c]?.startsWith('group')) pairs.push({ g: c, p: c + 1 });
      if (head[c]?.startsWith('approved')) approved = c;
    }
    return { year: m.year, pairs, approved };
  });
  const at = (p: (c: string) => boolean) => head.findIndex(p);
  const cCode = at((c) => c === 'course code');
  const cName = at((c) => c === 'course name');
  const cStatus = at((c) => c.startsWith('new'));
  const cRemark = at((c) => c.startsWith('remark'));
  const out: EctsChange[] = [];
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const code = cellText(row[cCode]);
    if (!code) continue;
    out.push({
      code, name: cellText(row[cName]), status: cellText(row[cStatus]), remark: cellText(row[cRemark]),
      blocks: blocks.map((b) => ({
        year: b.year,
        approved: cellText(row[b.approved]),
        allocations: b.pairs.map((p) => ({ group: canonicalGroup(cellText(row[p.g])), pct: cellNum(row[p.p]) })).filter((a) => a.group !== 'Onbekend'),
      })),
    });
  }
  return out;
}

function parseEnrollment(wb: Workbook): EnrollmentSnapshot[] {
  const out: EnrollmentSnapshot[] = [];
  for (const sheet of wb.sheets) {
    sheet.rows.forEach((row, h) => {
      const ci = (row ?? []).findIndex((c) => norm(cellText(c)) === 'cohort');
      if (ci < 0) return;
      const programs: { col: number; name: string }[] = [];
      for (let i = ci + 1; i < row.length; i++) if (cellText(row[i])) programs.push({ col: i, name: cellText(row[i]) });
      if (programs.length < 2) return;
      let date: string | null = null;
      for (let rr = Math.max(0, h - 1); rr <= h + 3 && !date; rr++) {
        for (let c = 0; c < ci && !date; c++) {
          const v = sheet.rows[rr]?.[c];
          if (typeof v === 'number') date = serialToDate(v);
          else if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v)) date = v.slice(0, 10);
        }
      }
      const cohorts: EnrollmentSnapshot['cohorts'] = [];
      let total: (number | null)[] = [];
      for (let rr = h + 1; rr < sheet.rows.length; rr++) {
        const r = sheet.rows[rr] ?? [];
        if (norm(cellText(r[ci])) === 'cohort') break;
        const values = programs.map((p) => cellNum(r[p.col]));
        const label = cellText(r[ci]);
        if (!label && values.every((v) => v == null)) break;
        if (!label || /^tota/i.test(label)) {
          total = values;
          break;
        }
        cohorts.push({ cohort: label, values });
      }
      if (cohorts.length && date) out.push({ date, label: date ?? `Blok ${out.length + 1}`, programs: programs.map((p) => p.name), cohorts, total });
    });
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

function parseBep(wb: Workbook): SmallTable | null {
  for (const sheet of wb.sheets) {
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const ci = row.findIndex((c) => /estimation per group|prognose per groep/i.test(cellText(c)));
      if (ci < 0) continue;
      const columns: string[] = [];
      for (let i = ci + 1; i < row.length && cellText(row[i]); i++) columns.push(cellText(row[i]));
      const rows: (string | number | null)[][] = [];
      for (let rr = r + 1; rr < sheet.rows.length; rr++) {
        const x = sheet.rows[rr] ?? [];
        const label = cellText(x[ci]);
        const values = columns.map((_, k) => cellNum(x[ci + 1 + k]));
        if (!label && values.every((v) => v == null)) break;
        rows.push([label ? canonicalGroup(label) : 'Totaal', ...values]);
      }
      return { title: `${sheet.name} · ${cellText(row[ci])}`, columns: ['Groep', ...columns], rows };
    }
  }
  return null;
}

export function looksLikeEcts(wb: Workbook): boolean {
  return wb.sheets.some((s) => isMainSheet(s) >= 0);
}

export function parseEcts(wb: Workbook, opts: { includeTeachers: boolean }): { payload: EctsPayload; notes: string[] } {
  const sheet = wb.sheets.find((s) => isMainSheet(s) >= 0);
  if (!sheet) throw new Error('Geen ECTS-tabblad gevonden (verwacht kolommen "VAKCODE" en "ECTS <jaar>").');
  const { years, courses, skipped, hasTeacherColumn } = parseCourses(sheet, isMainSheet(sheet), opts.includeTeachers);
  if (!years.length) throw new Error('Geen jaarkolommen herkend (zoals "ECTS 25" of "IEIS 25").');
  const checks = checkTotals(wb, courses);
  const notes = [
    `${courses.length} vakregels uit tabblad "${sheet.name}", jaren ${years.join(', ')}`,
    ...(skipped ? [`${skipped} regels zonder vakcode overgeslagen (totaalregels)`] : []),
    ...(hasTeacherColumn ? [opts.includeTeachers ? 'Docentnamen zijn opgenomen' : 'Docentnamen zijn weggelaten (persoonsgegevens)'] : []),
  ];
  return {
    payload: {
      sheet: sheet.name, years, courses, projects: parseProjects(wb), changes: parseChanges(wb),
      enrollment: parseEnrollment(wb), bep: parseBep(wb), checks, teacherNames: opts.includeTeachers && hasTeacherColumn,
    },
    notes,
  };
}

export type { Cell };
