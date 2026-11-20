/** Journal ranking and group-member lists. */
import { cellNum, cellText, findRow, norm, type Workbook } from './xlsx';
import type { JournalRank, JournalsPayload, MembersPayload } from './types';

function rankSheets(wb: Workbook) {
  return wb.sheets
    .map((s) => ({ s, h: findRow(s.rows.slice(0, 10), (r) => r.some((c) => c === 'journal' || c === 'tijdschrift' || c === 'journal name') && r.some((c) => c === 'quartile' || c === 'kwartiel' || c === 'rank')) }))
    .filter((x) => x.h >= 0);
}

export const looksLikeJournals = (wb: Workbook) => rankSheets(wb).length > 0;

export function parseJournals(wb: Workbook): { payload: JournalsPayload; notes: string[] } {
  const rows: JournalRank[] = [];
  for (const { s, h } of rankSheets(wb)) {
    const head = (s.rows[h] ?? []).map((c) => norm(cellText(c)));
    const at = (p: (c: string) => boolean) => head.findIndex(p);
    const cJ = at((c) => c === 'journal' || c === 'tijdschrift' || c === 'journal name');
    const cY = at((c) => c === 'year' || c === 'jaar' || c === 'jcr year');
    const cR = at((c) => c === 'rank' || c === 'ranking');
    const cQ = at((c) => c === 'quartile' || c === 'kwartiel' || c.startsWith('jif quartile'));
    const cP = at((c) => c === 'percentile' || c.startsWith('jif percentile'));
    const cats = head.map((c, i) => (c.startsWith('category') || c.startsWith('categorie') ? i : -1)).filter((i) => i >= 0);
    const sheetYear = Number(/(\d{4})/.exec(s.name)?.[1]) || null;
    for (let r = h + 1; r < s.rows.length; r++) {
      const row = s.rows[r] ?? [];
      const journal = cellText(row[cJ]);
      if (!journal) continue;
      const q = cellText(row[cQ]).toUpperCase().replace(/\s/g, '');
      rows.push({
        journal,
        year: cellNum(row[cY]) ?? sheetYear,
        rank: cellText(row[cR]) || null,
        quartile: /^Q[1-4]$/.test(q) ? q : null,
        percentile: cellNum(row[cP]),
        categories: cats.map((i) => cellText(row[i])).filter(Boolean),
      });
    }
  }
  const years = [...new Set(rows.map((r) => r.year).filter(Boolean))].sort();
  return { payload: { rows }, notes: [`${rows.length} tijdschriften${years.length ? `, rankingjaar ${years.join(', ')}` : ''}`] };
}

const NAME_LIKE = /^[^\d@]{2,}[,\s][^\d@]{1,}$/;

function memberSheet(wb: Workbook) {
  // A sheet that is essentially one column of person names (optionally with a header).
  return wb.sheets.find((s) => {
    const filled = s.rows.filter((r) => r.some((c) => c != null));
    if (filled.length < 2) return false;
    const width = Math.max(...filled.map((r) => r.filter((c) => c != null).length));
    if (width > 2) return false;
    const names = filled.map((r) => cellText(r.find((c) => c != null))).filter((t) => NAME_LIKE.test(t));
    return names.length >= Math.max(2, filled.length * 0.8);
  });
}

export const looksLikeMembers = (wb: Workbook) => !!memberSheet(wb);

export function parseMembers(wb: Workbook, fileName: string): { payload: MembersPayload; notes: string[]; label: string } {
  const s = memberSheet(wb);
  if (!s) throw new Error('Geen ledenlijst gevonden (verwacht één kolom met namen zoals "Achternaam, Voornaam").');
  const names = [...new Set(s.rows.map((r) => cellText(r.find((c) => c != null))).filter((t) => NAME_LIKE.test(t) && !/^(name|naam|author|auteur)s?$/i.test(t)))];
  const group = /\b([A-Z]{2,6})\b/.exec(s.name)?.[1] ?? /_([A-Z]{2,6})(?:_|\.|$)/.exec(fileName)?.[1] ?? 'Groep';
  return { payload: { group, names }, notes: [`${names.length} namen uit tabblad "${s.name}"`], label: `${group}-leden` };
}

/** "Authors" sheets with publication counts are derived from Pure; the dashboard computes them itself. */
export function looksLikeAuthorCounts(wb: Workbook): boolean {
  return wb.sheets.some((s) => findRow(s.rows.slice(0, 5), (r) => r.includes('author') && r.some((c) => c.startsWith('publications'))) >= 0);
}
