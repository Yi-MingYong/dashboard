import type { Filters } from '../lib/analytics';
import type { Dataset, Publication } from '../lib/model';
import type { CategoryId } from '../lib/types';
import type { TabId } from '../state';
import type { Workspace } from '../workspace';

export interface ViewProps {
  ds: Dataset;
  pubs: Publication[];
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  /** Selection of the active tab (publication index, person id or venue key). */
  sel: string | null;
  setSel: (v: string | null) => void;
  openPerson: (id: string) => void;
  openPub: (idx: number) => void;
  openVenue: (venue: string) => void;
  goTab: (tab: TabId) => void;
  ws: Workspace;
}

/** Three-way grouping used by the charts: articles (red), conference (slate), everything else (gray). */
export const GROUPS = [
  { id: 'journal', label: 'Artikelen', color: 'var(--red)', token: 'red' },
  { id: 'conference', label: 'Conferentie', color: 'var(--slate)', token: 'slate' },
  { id: 'other', label: 'Overig', color: 'var(--gray)', token: 'gray' },
] as const;

export function groupOf(c: CategoryId): 'journal' | 'conference' | 'other' {
  return c === 'journal' || c === 'conference' ? c : 'other';
}

export const groupColor = (c: CategoryId) => GROUPS.find((g) => g.id === groupOf(c))!.color;
