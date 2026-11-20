/**
 * Teaching-capacity scenario parser. Academic years ("2025/2026") are found
 * wherever they appear as column headers; the label row above a year row names
 * the measure ("expected own enrollment", "expected hours", "expected FTE").
 * More or fewer years, or extra sections, are picked up automatically.
 */
import { cellNum, cellText, norm, type Cell, type Sheet, type Workbook } from './xlsx';
import type { CapacityCourse, CapacityPayload, CapacitySection } from './types';

const AY = /^(\d{4})\s*[/-]\s*(\d{2}|\d{4})$/;

export function normAy(s: string): string | null {
  const m = AY.exec(s.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2].length === 2 ? Number(`${String(a).slice(0, 2)}${m[2]}`) : Number(m[2]);
  return b === a + 1 ? `${a}/${b}` : null;
}

function measureName(label: string): string {
  const n = norm(label);
  if (/enrol/.test(n)) return 'Inschrijvingen';
  if (/fte/.test(n)) return 'FTE';
  if (/hour|uren/.test(n)) return 'Uren';
  return label || 'Waarde';
}

interface YearRow {
  row: number;
  cols: { col: number; ay: string; group: string }[];
}

function yearRows(sheet: Sheet): YearRow[] {
  const out: YearRow[] = [];
  sheet.rows.forEach((row, r) => {
    const cols = (row ?? []).map((c, i) => ({ col: i, ay: normAy(cellText(c)) })).filter((x): x is { col: number; ay: string } => !!x.ay);
    if (cols.length < 2) return;
    const above = sheet.rows[r - 1] ?? [];
    const labels = above.map((c, i) => ({ col: i, label: cellText(c) })).filter((x) => x.label);
    out.push({
      row: r,
      cols: cols.map((c) => {
        const lab = [...labels].reverse().find((l) => l.col <= c.col && l.col >= Math.min(...cols.map((x) => x.col)) - 0);
        return { ...c, group: measureName(lab?.label ?? '') };
      }),
    });
  });
  return out;
}

function readValues(row: Cell[], cols: YearRow['cols']) {
  const values: Record<string, Record<string, number | null>> = {};
  for (const c of cols) (values[c.group] ??= {})[c.ay] = cellNum(row[c.col]);
  return values;
}

export function looksLikeCapacity(wb: Workbook): boolean {
  return wb.sheets.some((s) => yearRows(s).some((y) => {
    const head = (s.rows[y.row] ?? []).map((c) => norm(cellText(c)));
    return head.includes('course') && head.includes('driver');
  }));
}

export function parseCapacity(wb: Workbook): { payload: CapacityPayload; notes: string[] } {
  const courses: CapacityCourse[] = [];
  const sections: CapacitySection[] = [];
  const notes: string[] = [];
  const assumptions: CapacityPayload['assumptions'] = [];
  let cohorts: CapacityPayload['cohorts'] = { years: [], series: [] };
  const allYears = new Set<string>();
  const groups = new Set<string>();

  for (const sheet of wb.sheets) {
    const yrs = yearRows(sheet);
    yrs.forEach((yr, k) => {
      yr.cols.forEach((c) => allYears.add(c.ay));
      const head = (sheet.rows[yr.row] ?? []).map((c) => norm(cellText(c)));
      const stop = yrs[k + 1]?.row ?? sheet.rows.length;
      if (head.includes('course') && head.includes('driver')) {
        const at = (p: (c: string) => boolean) => head.findIndex(p);
        const cCode = at((c) => c === 'code');
        const cName = at((c) => c === 'course');
        const cShare = at((c) => c.startsWith('our perc'));
        const cDriver = at((c) => c === 'driver');
        const cFactor = at((c) => c === 'percentage');
        yr.cols.forEach((c) => groups.add(c.group));
        let blank = 0;
        for (let r = yr.row + 1; r < stop; r++) {
          const row = sheet.rows[r] ?? [];
          const name = cellText(row[cName]);
          if (!name) {
            if (++blank >= 2) break;
            continue;
          }
          blank = 0;
          courses.push({
            code: cellText(row[cCode]), name, share: cellNum(row[cShare]), driver: cellText(row[cDriver]), factor: cellNum(row[cFactor]),
            values: readValues(row, yr.cols),
          });
        }
        return;
      }
      const firstAy = Math.min(...yr.cols.map((c) => c.col));
      if (firstAy <= 1 && cellText(sheet.rows[yr.row]?.[0]) === '') {
        // Cohort table: label column 0, academic years from column 1.
        const series: { label: string; values: (number | null)[] }[] = [];
        for (let r = yr.row + 1; r < stop; r++) {
          const row = sheet.rows[r] ?? [];
          const label = cellText(row[0]);
          const values = yr.cols.map((c) => cellNum(row[c.col]));
          if (!label) {
            if (series.length) break;
            continue;
          }
          if (values.every((v) => v == null)) break;
          series.push({ label, values });
        }
        if (series.length) cohorts = { years: yr.cols.map((c) => c.ay), series };
        for (let r = 0; r < yr.row; r++) {
          const row = sheet.rows[r] ?? [];
          const label = cellText(row[0]);
          if (label && row.length > 1 && cellText(row[1])) assumptions.push({ label, value: cellNum(row[1]), text: cellText(row[1]) });
        }
        for (let r = yr.row + 1 + series.length; r < sheet.rows.length; r++) {
          const t = cellText(sheet.rows[r]?.[0]);
          const t2 = cellText(sheet.rows[r]?.[1]);
          if (t && t.length > 40) notes.push(t);
          else if (t2 && t2.length > 30) notes.push(`${t ? `${t}: ` : ''}${t2}`);
        }
        return;
      }
      // Summary section ("Total capacity required", "Capacity available", "Metrics").
      const title = cellText(sheet.rows[yr.row]?.[0]) || cellText(sheet.rows[yr.row - 1]?.[0]) || `Sectie ${sections.length + 1}`;
      const rows: CapacitySection['rows'] = [];
      for (let r = yr.row + 1; r < stop; r++) {
        const row = sheet.rows[r] ?? [];
        const label = cellText(row[0]);
        if (!label) {
          if (rows.length) break;
          continue;
        }
        if (/^notes?$/i.test(label)) break;
        rows.push({ label, values: readValues(row, yr.cols) });
      }
      if (rows.length) sections.push({ title, groups: [...new Set(yr.cols.map((c) => c.group))], rows });
    });
    // Free-text notes after a "Notes" header.
    const ni = sheet.rows.findIndex((r) => /^notes?$/i.test(cellText(r?.[0])));
    if (ni >= 0) for (let r = ni + 1; r < sheet.rows.length; r++) {
      const t = cellText(sheet.rows[r]?.[0]);
      if (t) notes.push(t);
    }
  }
  if (!courses.length && !sections.length) throw new Error('Geen capaciteitstabellen herkend (verwacht kolommen "course" en "driver" en academische jaren zoals 2025/2026).');
  const years = [...allYears].sort();
  return {
    payload: { years, assumptions, cohorts, courseGroups: [...groups], courses, sections, notes },
    notes: [`${courses.length} vakken en ${sections.length} overzichtssecties, academische jaren ${years[0]}–${years[years.length - 1]}`],
  };
}
