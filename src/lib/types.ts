/** Publication categories and the mapping from Pure output types (EN + NL). */

export type CategoryId = 'journal' | 'conference' | 'book' | 'thesis' | 'report' | 'preprint' | 'other';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  short: string;
  /** 1-based categorical colour slot; fixed per category so colour follows the entity. */
  slot: number;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'journal', label: 'Tijdschriftartikelen', short: 'Artikelen', slot: 1 },
  { id: 'conference', label: 'Conferentiebijdragen', short: 'Conferentie', slot: 2 },
  { id: 'book', label: 'Boeken & hoofdstukken', short: 'Boeken', slot: 3 },
  { id: 'thesis', label: 'Proefschriften', short: 'Proefschriften', slot: 4 },
  { id: 'report', label: 'Rapporten & working papers', short: 'Rapporten', slot: 5 },
  { id: 'preprint', label: 'Preprints', short: 'Preprints', slot: 6 },
  { id: 'other', label: 'Overige output', short: 'Overig', slot: 7 },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryDef>;

interface TypeRule {
  label: string;
  category: CategoryId;
}

/** Pure output types, English and Dutch spellings, mapped to one Dutch label. */
const TYPE_RULES: Record<string, TypeRule> = {
  article: { label: 'Artikel', category: 'journal' },
  tijdschriftartikel: { label: 'Artikel', category: 'journal' },
  'review article': { label: 'Reviewartikel', category: 'journal' },
  'conference contribution': { label: 'Conferentiebijdrage', category: 'conference' },
  conferentiebijdrage: { label: 'Conferentiebijdrage', category: 'conference' },
  'conference article': { label: 'Conferentieartikel', category: 'conference' },
  paper: { label: 'Paper (congres)', category: 'conference' },
  chapter: { label: 'Hoofdstuk', category: 'book' },
  hoofdstuk: { label: 'Hoofdstuk', category: 'book' },
  book: { label: 'Boek', category: 'book' },
  boek: { label: 'Boek', category: 'book' },
  'book editing': { label: 'Boekredactie', category: 'book' },
  boekredactie: { label: 'Boekredactie', category: 'book' },
  report: { label: 'Rapport', category: 'report' },
  rapport: { label: 'Rapport', category: 'report' },
  'working paper': { label: 'Working paper', category: 'report' },
  preprint: { label: 'Preprint', category: 'preprint' },
  abstract: { label: 'Abstract', category: 'other' },
  'meeting abstract': { label: 'Abstract', category: 'other' },
  poster: { label: 'Poster', category: 'other' },
  editorial: { label: 'Redactioneel', category: 'other' },
  'foreword/editorial': { label: 'Redactioneel', category: 'other' },
  'book review': { label: 'Boekbespreking', category: 'other' },
  'comment/letter to the editor': { label: 'Commentaar / brief', category: 'other' },
  'special issue': { label: 'Themanummer', category: 'other' },
  'inaugural/farewell speech': { label: 'Oratie / afscheidsrede', category: 'other' },
  'inaugurale/afscheids rede': { label: 'Oratie / afscheidsrede', category: 'other' },
  software: { label: 'Software', category: 'other' },
  'patent publication': { label: 'Octrooi', category: 'other' },
  other: { label: 'Overig', category: 'other' },
  'other contribution': { label: 'Overig', category: 'other' },
  'overige bijdrage': { label: 'Overig', category: 'other' },
};

const TY_FALLBACK: Record<string, CategoryId> = {
  JOUR: 'journal', JFULL: 'journal', MGZN: 'journal', CONF: 'conference', CPAPER: 'conference',
  CHAP: 'book', BOOK: 'book', EDBOOK: 'book', THES: 'thesis', RPRT: 'report', UNPB: 'preprint',
};

export function classifyType(m3: string | undefined, ty: string | undefined): TypeRule {
  const key = (m3 ?? '').trim().toLowerCase();
  if (TYPE_RULES[key]) return TYPE_RULES[key];
  if (/^(phd thesis|dissertatie)/.test(key)) return { label: 'Proefschrift', category: 'thesis' };
  if (/thesis|proefschrift/.test(key)) return { label: 'Scriptie / proefschrift', category: 'thesis' };
  return { label: m3?.trim() || ty || 'Onbekend', category: TY_FALLBACK[ty ?? ''] ?? 'other' };
}
