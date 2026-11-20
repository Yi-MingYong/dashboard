import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, loadDatasets, LOGOUT_URL } from './api';
import { readTokens, ThemeContext, type ChartTokens } from './charts/theme';
import { APP } from './config';
import { FilterBar } from './components/FilterBar';
import { Icon } from './components/Icon';
import { usePopover } from './components/ui';
import { applyFilters, EMPTY_FILTERS, personStats, type Filters } from './lib/analytics';
import { download, toBibtex, toCsv, toRis } from './lib/export';
import { fmt } from './lib/format';
import type { Dataset } from './lib/model';
import type { DatasetInfo, Me, Role } from './shared/model';
import { readUrl, TABS, writeUrl, type TabId } from './state';
import { Admin } from './views/Admin';
import { Capacity } from './views/Capacity';
import { Collaboration } from './views/Collaboration';
import type { ViewProps } from './views/ctx';
import { DataQuality } from './views/DataQuality';
import { Education } from './views/Education';
import { Failure, Loading, NoAccess, SessionExpired, Setup, type SetupInfo } from './views/Gate';
import { Overview } from './views/Overview';
import { People } from './views/People';
import { Publications } from './views/Publications';
import { Topics } from './views/Topics';
import { Venues } from './views/Venues';
import { buildWorkspace, datasetFor, type Workspace } from './workspace';

type SelMap = Partial<Record<TabId, string | null>>;

const ROLE_SHORT: Record<Role, string> = { viewer: 'Lezer', education: 'Lezer · onderwijs', admin: 'Beheerder' };

function ExportMenu({ ds, pubs, filters }: { ds: Dataset; pubs: Dataset['pubs']; filters: Filters }) {
  const { open, setOpen, ref } = usePopover();
  const stamp = `${ds.meta.id}${filters.from || filters.to ? `-${filters.from ?? ds.years.min}-${filters.to ?? ds.years.max}` : ''}`;
  const sorted = useMemo(() => [...pubs].sort((a, b) => b.sortDate.localeCompare(a.sortDate)), [pubs]);
  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };
  const authorsCsv = () => {
    const rows = personStats(ds, pubs).sort((a, b) => b.count - a.count);
    const header = ['Naam', 'Outputs', 'Tijdschriftartikelen', 'Conferentiebijdragen', 'Eerste jaar', 'Laatste jaar', 'Unieke co-auteurs'];
    const q = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return '﻿' + [header, ...rows.map((s) => [s.name, s.count, s.journal, s.conference, s.first ?? '', s.last ?? '', s.coauthors])].map((r) => r.map(q).join(',')).join('\r\n');
  };
  return (
    <div className="pop-anchor" ref={ref}>
      <button type="button" className="btn btn-dark" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!pubs.length}>
        <Icon name="download" size={14} /><span className="btn-label">Exporteer</span>
      </button>
      {open && (
        <div className="popover right" role="menu" style={{ minWidth: 250 }}>
          <div className="menu-cap caps">Huidige selectie · {fmt(pubs.length)} outputs</div>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => download(`publicaties-${stamp}.csv`, toCsv(ds, sorted), 'text/csv'))}>Publicaties<span className="count">CSV</span></button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => download(`publicaties-${stamp}.ris`, toRis(sorted), 'application/x-research-info-systems'))}>Publicaties<span className="count">RIS</span></button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => download(`publicaties-${stamp}.bib`, toBibtex(ds, sorted), 'application/x-bibtex'))}>Publicaties<span className="count">BibTeX</span></button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => download(`auteurs-${stamp}.csv`, authorsCsv(), 'text/csv'))}>Auteurs<span className="count">CSV</span></button>
        </div>
      )}
    </div>
  );
}

/** Phones hide the sidebar footer, so the account and sign-out live here instead. */
function AccountMenu({ me, initials }: { me: Me; initials: string }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="pop-anchor mobile-only" ref={ref}>
      <button type="button" className="btn btn-icon account-btn" aria-haspopup="true" aria-expanded={open} aria-label={`Account ${me.email}`} onClick={() => setOpen(!open)}>
        {initials}
      </button>
      {open && (
        <div className="popover right" role="menu" style={{ minWidth: 240 }}>
          <div style={{ padding: '10px 12px 8px' }}>
            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{me.name}</div>
            {me.name !== me.email && <div className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{me.email}</div>}
            <div className="caps" style={{ marginTop: 6 }}>{ROLE_SHORT[me.role]}</div>
          </div>
          <a role="menuitem" className="menu-item" href={LOGOUT_URL}>Uitloggen</a>
        </div>
      )}
    </div>
  );
}

/* ───────────── access gate ───────────── */

type Gate =
  | { s: 'loading' }
  | { s: 'setup'; info: SetupInfo }
  | { s: 'denied'; email: string; admins: string[] }
  | { s: 'login' }
  | { s: 'error'; message: string }
  | { s: 'ready'; me: Me; list: DatasetInfo[]; ws: Workspace; failed: DatasetInfo[] };

function toGate(e: unknown): Gate {
  if (e instanceof ApiError) {
    if (e.status === 401) return { s: 'login' };
    if (e.code === 'setup') return { s: 'setup', info: e.body as unknown as SetupInfo };
    if (e.code === 'no-access') return { s: 'denied', email: String(e.body.email ?? ''), admins: (e.body.admins as string[]) ?? [] };
    if (e.code === 'network') return { s: 'error', message: 'Geen verbinding met de server. Controleer je internetverbinding.' };
  }
  return { s: 'error', message: (e as Error).message };
}

export function App() {
  const [tokens, setTokens] = useState<ChartTokens | null>(null);
  const [gate, setGate] = useState<Gate>({ s: 'loading' });

  useLayoutEffect(() => {
    setTokens(readTokens());
  }, []);

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      const list = await api.datasets();
      const { datasets, failed } = await loadDatasets(list);
      setGate({ s: 'ready', me, list, ws: buildWorkspace(datasets), failed });
    } catch (e) {
      setGate(toGate(e));
    }
  }, []);
  const retry = useCallback(() => {
    setGate({ s: 'loading' });
    load();
  }, [load]);
  const onAuthLost = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) setGate({ s: 'login' });
    else if (e instanceof ApiError && e.code === 'no-access') setGate(toGate(e));
  }, []);

  useEffect(() => {
    document.fonts?.ready.then(() => setTokens(readTokens()));
    load();
  }, [load]);

  if (!tokens || gate.s === 'loading') return <Loading />;
  if (gate.s === 'setup') return <Setup info={gate.info} />;
  if (gate.s === 'denied') return <NoAccess email={gate.email} admins={gate.admins} onRetry={retry} />;
  if (gate.s === 'login') return <SessionExpired />;
  if (gate.s === 'error') return <Failure message={gate.message} onRetry={retry} />;
  return (
    <ThemeContext.Provider value={tokens}>
      <Dashboard ws={gate.ws} me={gate.me} list={gate.list} failed={gate.failed} onChanged={load} onAuthLost={onAuthLost} />
    </ThemeContext.Provider>
  );
}

/* ───────────── dashboard ───────────── */

function Dashboard({ ws, me, list, failed, onChanged, onAuthLost }: {
  ws: Workspace; me: Me; list: DatasetInfo[]; failed: DatasetInfo[]; onChanged: () => Promise<void>; onAuthLost: (e: unknown) => void;
}) {
  const admin = me.role === 'admin';
  const initial = useMemo(readUrl, []);
  const [incoming, setIncoming] = useState<File[]>([]);
  const entries = ws.entries;
  const [dsId, setDsId] = useState<string | null>(initial.ds);
  const [tab, setTab] = useState<TabId>(initial.tab);
  const [selMap, setSelMap] = useState<SelMap>({ [initial.tab]: initial.sel });
  const [filters, setFiltersState] = useState<Filters>(initial.filters);
  const searchRef = useRef<HTMLInputElement>(null);
  const defaultId = entries[0]?.id ?? null;
  const currentId = dsId && entries.some((e) => e.id === dsId) ? dsId : defaultId;
  const ds = currentId ? datasetFor(ws, currentId) : null;

  const tabs = TABS.filter((t) => (t.id === 'beheer' ? admin : t.id === 'onderwijs' ? !!ws.ects : t.id === 'capaciteit' ? !!ws.capacity : true));
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'overzicht';

  useEffect(() => {
    if (!ds) return;
    setFiltersState((f) => ({
      ...f,
      from: f.from != null && f.from > ds.years.min && f.from <= ds.years.max ? f.from : null,
      to: f.to != null && f.to < ds.years.max && f.to >= ds.years.min ? f.to : null,
      person: f.person && ds.people.has(f.person) ? f.person : null,
      keyword: f.keyword && ds.keywordLabels.has(f.keyword) ? f.keyword : null,
      venue: f.venue && applyFilters(ds, { ...EMPTY_FILTERS, venue: f.venue }).length ? f.venue : null,
    }));
  }, [ds]);

  const sel = selMap[activeTab] ?? null;
  useEffect(() => {
    writeUrl({ ds: currentId, tab: activeTab, sel, filters }, defaultId);
  }, [currentId, activeTab, sel, filters, defaultId]);

  const firstTab = useRef(true);
  useEffect(() => {
    document.querySelector('.nav-item[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (firstTab.current) firstTab.current = false;
    else if (window.matchMedia('(max-width: 860px)').matches) window.scrollTo({ top: 0 });
  }, [activeTab]);

  const setSel = useCallback((v: string | null) => setSelMap((m) => ({ ...m, [activeTab]: v })), [activeTab]);
  const openIn = useCallback((t: TabId, v: string) => {
    setSelMap((m) => ({ ...m, [t]: v }));
    setTab(t);
  }, []);
  const openPerson = useCallback((id: string) => openIn('auteurs', id), [openIn]);
  const openPub = useCallback((idx: number) => openIn('publicaties', String(idx)), [openIn]);
  const openVenue = useCallback((v: string) => openIn('kanalen', v), [openIn]);
  const setFilters = useCallback((patch: Partial<Filters>) => setFiltersState((f) => ({ ...f, ...patch })), []);
  const pubs = useMemo(() => (ds ? applyFilters(ds, filters) : []), [ds, filters]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, tabs.length)) {
        e.preventDefault();
        setTab(tabs[n - 1].id);
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tabs]);

  const tabDef = TABS.find((t) => t.id === activeTab)!;
  const researchTab = !['onderwijs', 'capaciteit', 'beheer'].includes(activeTab);
  const viewProps: ViewProps | null = ds ? { ds, pubs, filters, setFilters, sel, setSel, openPerson, openPub, openVenue, goTab: setTab, ws } : null;
  const initials = (me.name.includes('@') ? me.name.split('@')[0].split(/[._-]+/) : me.name.split(/\s+/)).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <nav className="nav" aria-label="Onderdelen">
        <div className="nav-brand">
          <div className="mark" aria-hidden="true"><Icon name="logo" size={15} stroke={2.8} square /></div>
          <div style={{ minWidth: 0 }}>
            <div className="nav-brand-title">{APP.short}</div>
            <div className="nav-brand-sub">{APP.orgShort}</div>
          </div>
        </div>
        <div className="nav-section caps">Analyse</div>
        <div className="nav-items">
          {tabs.map((t, i) => (
            <button key={t.id} type="button" className="nav-item" aria-current={activeTab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)} title={`${t.label}${i < 9 ? ` (toets ${i + 1})` : ''}`}>
              <Icon name={t.icon} size={15} />
              <span className="label">{t.label}</span>
              <span className="key">{i < 9 ? i + 1 : ''}</span>
            </button>
          ))}
        </div>
        <div className="nav-foot">
          <div className="nav-foot-badge" aria-hidden="true">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="nav-foot-title ellipsis" title={me.email}>{me.name}</div>
            <div className="nav-foot-sub">{ROLE_SHORT[me.role]} · <a href={LOGOUT_URL}>Uitloggen</a></div>
          </div>
        </div>
      </nav>

      <section className="main">
        <header className="topbar">
          <div className="crumbs">
            <div className="mark mobile-mark" aria-hidden="true"><Icon name="logo" size={15} stroke={2.8} square /></div>
            <span className="muted">{APP.org}</span>
            <span className="sep">/</span>
            <h1 className="here" style={{ fontSize: 13 }}>{tabDef.label}</h1>
            {failed.length > 0 && (
              <span className="tag-filter" style={{ marginLeft: 8 }} title={failed.map((d) => d.label).join(', ')}>
                <span className="k">Let op</span><span className="v">{failed.length === 1 ? '1 dataset kon' : `${failed.length} datasets konden`} niet geladen worden</span>
              </span>
            )}
          </div>
          {researchTab && entries.length > 0 && (
            <select className="select ds" aria-label="Dataset" value={currentId ?? ''} onChange={(e) => setDsId(e.target.value)}>
              {entries.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          )}
          {researchTab && ds && <ExportMenu ds={ds} pubs={pubs} filters={filters} />}
          <AccountMenu me={me} initials={initials} />
        </header>

        {researchTab && ds && <FilterBar ds={ds} filters={filters} setFilters={setFilters} resultCount={pubs.length} searchRef={searchRef} />}

        <div className="content">
          {activeTab === 'beheer' && admin && <Admin me={me} datasets={list} onChanged={onChanged} onAuthLost={onAuthLost} incoming={incoming} onIncomingTaken={() => setIncoming([])} />}
          {activeTab === 'onderwijs' && <Education ects={ws.ects} />}
          {activeTab === 'capaciteit' && <Capacity cap={ws.capacity} />}
          {researchTab && !viewProps && (
            <div className="state"><div><Icon name="data" size={22} /><p>Er is nog geen Pure-export gepubliceerd.{admin ? ' Voeg er een toe via Beheer.' : ''}</p></div></div>
          )}
          {researchTab && viewProps && (
            <>
              {activeTab === 'overzicht' && <Overview {...viewProps} />}
              {activeTab === 'publicaties' && <Publications {...viewProps} />}
              {activeTab === 'auteurs' && <People {...viewProps} />}
              {activeTab === 'themas' && <Topics {...viewProps} />}
              {activeTab === 'kanalen' && <Venues {...viewProps} />}
              {activeTab === 'samenwerking' && <Collaboration {...viewProps} />}
              {activeTab === 'data' && <DataQuality {...viewProps} entries={entries} onImport={admin ? (f) => { setIncoming([f]); setTab('beheer'); } : undefined} />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
