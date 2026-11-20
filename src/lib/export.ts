/** CSV / RIS / BibTeX export of the current selection. */
import type { Dataset, Publication } from './model';
import { serializeRis } from './ris';
import { fold } from './text';
import { CATEGORY_BY_ID } from './types';

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote as needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(ds: Dataset, pubs: Publication[]): string {
  const header = ['Jaar', 'Titel', 'Ondertitel', 'Auteurs', 'Aantal auteurs', 'Categorie', 'Type (Pure)', 'Kanaal', 'Tijdschrift',
    'Conferentie', 'Uitgever', 'Reeks', 'DOI', 'URL', 'Trefwoorden'];
  const rows = pubs.map((p) => [
    p.year, p.title, p.subtitle, p.authors.map((a) => ds.people.get(a)?.name ?? a).join('; '), p.authorCount,
    CATEGORY_BY_ID[p.category].label, p.rawType, p.venue, p.journal?.name, p.conference?.name, p.publisher?.name,
    p.series?.name, p.doi ? `https://doi.org/${p.doi}` : '', p.url ?? p.scopusUrl ?? '',
    p.keywords.map((k) => ds.keywordLabels.get(k) ?? k).join('; '),
  ]);
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function toRis(pubs: Publication[]): string {
  return serializeRis(pubs.map((p) => p.raw));
}

const BIB_TYPE: Record<string, string> = {
  journal: 'article', conference: 'inproceedings', book: 'incollection', thesis: 'phdthesis',
  report: 'techreport', preprint: 'misc', other: 'misc',
};

function bibEscape(s: string): string {
  return s.replace(/([{}&%$#_])/g, '\\$1').replace(/\n+/g, ' ');
}

export function toBibtex(ds: Dataset, pubs: Publication[]): string {
  const used = new Set<string>();
  return pubs
    .map((p) => {
      const firstAuthor = p.raw.AU?.[0]?.split(',')[0] ?? 'anon';
      const word = fold(p.title).replace(/[^a-z0-9 ]/g, '').split(' ').find((w) => w.length > 3) ?? 'item';
      let key = `${fold(firstAuthor).replace(/[^a-z]/g, '')}${p.year ?? ''}${word}`;
      for (let i = 2; used.has(key); i++) key = `${key}${i}`;
      used.add(key);
      const type = p.rawType.match(/book editing|boekredactie/i) ? 'book' : p.rawType.match(/^(book|boek)$/i) ? 'book' : BIB_TYPE[p.category];
      const fields: [string, string | undefined][] = [
        ['title', p.subtitle ? `${p.title}: ${p.subtitle}` : p.title],
        ['author', (p.raw.AU ?? []).join(' and ') || undefined],
        ['editor', p.editors.length ? p.editors.join(' and ') : undefined],
        ['year', p.year ? String(p.year) : undefined],
        ['journal', p.journal?.name],
        ['booktitle', p.category !== 'journal' ? p.book ?? p.conference?.name : undefined],
        ['series', p.series?.name],
        ['publisher', p.publisher?.name],
        ['volume', p.volume],
        ['number', p.issue],
        ['pages', p.pages?.replace('–', '--')],
        ['doi', p.doi],
        ['url', p.url ?? p.scopusUrl],
        ['keywords', p.keywords.map((k) => ds.keywordLabels.get(k) ?? k).join(', ') || undefined],
      ];
      const body = fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${bibEscape(v!)}}`).join(',\n');
      return `@${type}{${key},\n${body}\n}`;
    })
    .join('\n\n');
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
