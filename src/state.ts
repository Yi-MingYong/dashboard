/** URL <-> state, so every view (including the selected row) can be bookmarked and shared. */
import { EMPTY_FILTERS, type Filters } from './lib/analytics';
import { CATEGORIES, type CategoryId } from './lib/types';

export const TABS = [
  { id: 'overzicht', label: 'Overzicht', icon: 'overview' },
  { id: 'publicaties', label: 'Publicaties', icon: 'list' },
  { id: 'auteurs', label: 'Auteurs', icon: 'people' },
  { id: 'themas', label: "Thema's", icon: 'topics' },
  { id: 'kanalen', label: 'Kanalen', icon: 'venues' },
  { id: 'samenwerking', label: 'Samenwerking', icon: 'network' },
  { id: 'onderwijs', label: 'Onderwijs', icon: 'education' },
  { id: 'capaciteit', label: 'Capaciteit', icon: 'capacity' },
  { id: 'data', label: 'Data & kwaliteit', icon: 'data' },
  { id: 'beheer', label: 'Beheer', icon: 'lock' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export interface UrlState {
  ds: string | null;
  tab: TabId;
  sel: string | null;
  filters: Filters;
}

const CAT_IDS = new Set(CATEGORIES.map((c) => c.id));

export function readUrl(): UrlState {
  const sp = new URLSearchParams(window.location.search);
  const num = (k: string) => {
    const v = Number(sp.get(k));
    return sp.get(k) && Number.isFinite(v) ? v : null;
  };
  const tab = sp.get('tab') as TabId | null;
  return {
    ds: sp.get('ds'),
    tab: tab && TABS.some((t) => t.id === tab) ? tab : 'overzicht',
    sel: sp.get('sel'),
    filters: {
      ...EMPTY_FILTERS,
      from: num('van'),
      to: num('tot'),
      cats: (sp.get('type') ?? '').split(',').filter((c): c is CategoryId => CAT_IDS.has(c as CategoryId)),
      person: sp.get('persoon'),
      keyword: sp.get('trefwoord'),
      venue: sp.get('kanaal'),
      q: sp.get('q') ?? '',
    },
  };
}

export function writeUrl(s: UrlState, defaultDs: string | null): void {
  const sp = new URLSearchParams();
  if (s.ds && s.ds !== defaultDs && !s.ds.startsWith('import-')) sp.set('ds', s.ds);
  if (s.tab !== 'overzicht') sp.set('tab', s.tab);
  if (s.sel) sp.set('sel', s.sel);
  const f = s.filters;
  if (f.from != null) sp.set('van', String(f.from));
  if (f.to != null) sp.set('tot', String(f.to));
  if (f.cats.length) sp.set('type', f.cats.join(','));
  if (f.person) sp.set('persoon', f.person);
  if (f.keyword) sp.set('trefwoord', f.keyword);
  if (f.venue) sp.set('kanaal', f.venue);
  if (f.q) sp.set('q', f.q);
  const qs = sp.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url);
}
