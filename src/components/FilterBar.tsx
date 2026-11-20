import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { countBy, range, venueLabel, type Filters } from '../lib/analytics';
import { fmt } from '../lib/format';
import type { Dataset } from '../lib/model';
import { fold } from '../lib/text';
import { CATEGORIES, type CategoryId } from '../lib/types';
import { Icon } from './Icon';
import { Combobox } from './ui';

const CURRENT_YEAR = new Date().getFullYear();

export function FilterBar({ ds, filters, setFilters, resultCount, searchRef }: {
  ds: Dataset; filters: Filters; setFilters: (p: Partial<Filters>) => void; resultCount: number;
  searchRef?: RefObject<HTMLInputElement>;
}) {
  const { min, max } = ds.years;
  const years = range(min, max);
  const presets = useMemo(() => {
    const list: { id: string; label: string; from: number | null; to: number | null }[] = [{ id: 'all', label: 'Alle jaren', from: null, to: null }];
    for (const n of [3, 10]) if (max - n + 1 > min) list.push({ id: `l${n}`, label: `Laatste ${n} jaar`, from: max - n + 1, to: null });
    const lastFull = max >= CURRENT_YEAR ? CURRENT_YEAR - 1 : max;
    for (const y of [lastFull, lastFull - 1]) if (y >= min && y <= max) list.push({ id: `y${y}`, label: String(y), from: y, to: y });
    return list;
  }, [min, max]);
  const isActive = (p: (typeof presets)[number]) =>
    p.from === filters.from && (p.to === filters.to || (p.to == null && filters.to == null));

  const [q, setQ] = useState(filters.q);
  useEffect(() => {
    setQ(filters.q);
  }, [filters.q]);
  useEffect(() => {
    if (q === filters.q) return;
    const id = setTimeout(() => setFilters({ q }), 200);
    return () => clearTimeout(id);
  }, [q, filters.q, setFilters]);

  const catCounts = useMemo(() => countBy(ds.pubs, (p) => p.category), [ds]);
  const personOptions = useMemo(
    () =>
      [...ds.people.values()]
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count || a.sortKey.localeCompare(b.sortKey))
        .map((p) => ({ value: p.id, label: p.name, count: p.count, search: fold(`${p.name} ${[...p.variants.keys()].join(' ')}`) })),
    [ds],
  );
  const hasAny = filters.from != null || filters.to != null || filters.cats.length || filters.person || filters.keyword || filters.venue || filters.q;
  const [open, setOpen] = useState(false);
  const activeCount = [filters.from != null || filters.to != null, filters.cats.length > 0, !!filters.person, !!filters.keyword, !!filters.venue, !!filters.q].filter(Boolean).length;
  const localRef = useRef<HTMLInputElement>(null);
  const ref = searchRef ?? localRef;

  return (
    <div className={`filterbar ${open ? 'open' : ''}`} role="search" aria-label="Filters">
      <button type="button" className="btn btn-sm filter-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="filter" size={13} /> Filters{activeCount ? ` · ${activeCount} actief` : ''}
        <Icon name="chevron" size={13} />
      </button>
      {presets.map((p) => (
        <button key={p.id} type="button" className="chip" aria-pressed={isActive(p)} onClick={() => setFilters({ from: p.from, to: p.to })}>
          {p.label}
        </button>
      ))}
      <span className="vsep" />
      <select
        className="select select-sm"
        aria-label="Vanaf jaar"
        value={filters.from ?? min}
        onChange={(e) => {
          const v = Number(e.target.value);
          setFilters({ from: v === min ? null : v, to: filters.to != null && filters.to < v ? v : filters.to });
        }}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <span className="muted">–</span>
      <select
        className="select select-sm"
        aria-label="Tot en met jaar"
        value={filters.to ?? max}
        onChange={(e) => {
          const v = Number(e.target.value);
          setFilters({ to: v === max ? null : v, from: filters.from != null && filters.from > v ? v : filters.from });
        }}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <span className="vsep" />
      <select
        className="select select-sm type-select"
        aria-label="Type output"
        value={filters.cats.length === 1 ? filters.cats[0] : filters.cats.length ? 'multi' : ''}
        onChange={(e) => setFilters({ cats: e.target.value ? [e.target.value as CategoryId] : [] })}
        style={filters.cats.length ? { borderColor: 'var(--ink)' } : undefined}
      >
        <option value="">Alle typen</option>
        {filters.cats.length > 1 && <option value="multi" disabled>{filters.cats.length} typen</option>}
        {CATEGORIES.filter((c) => catCounts.get(c.id)).map((c) => (
          <option key={c.id} value={c.id}>{c.label} ({fmt(catCounts.get(c.id) ?? 0)})</option>
        ))}
      </select>
      <Combobox
        ariaLabel="Persoon"
        placeholder="Alle personen"
        options={personOptions}
        value={filters.person}
        valueLabel={filters.person ? ds.people.get(filters.person)?.name : undefined}
        onChange={(v) => setFilters({ person: v })}
      />
      <label className="search grow">
        <Icon name="search" size={13} />
        <input
          ref={ref}
          className="input"
          type="search"
          placeholder="Titel, abstract, trefwoord, DOI…  ( / )"
          aria-label="Zoeken"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setQ(''), setFilters({ q: '' }))}
        />
      </label>
      {filters.keyword && (
        <span className="tag-filter">
          <span className="k">Trefwoord</span>
          <span className="v" title={ds.keywordLabels.get(filters.keyword)}>{ds.keywordLabels.get(filters.keyword) ?? filters.keyword}</span>
          <button type="button" aria-label="Verwijder trefwoordfilter" onClick={() => setFilters({ keyword: null })}><Icon name="x" size={12} stroke={2.5} /></button>
        </span>
      )}
      {filters.venue && (
        <span className="tag-filter">
          <span className="k">{{ j: 'Tijdschrift', c: 'Conferentie', p: 'Uitgever', s: 'Reeks' }[filters.venue[0] as 'j'] ?? 'Kanaal'}</span>
          <span className="v" title={venueLabel(ds, filters.venue)}>{venueLabel(ds, filters.venue)}</span>
          <button type="button" aria-label="Verwijder kanaalfilter" onClick={() => setFilters({ venue: null })}><Icon name="x" size={12} stroke={2.5} /></button>
        </span>
      )}
      {hasAny ? (
        <button type="button" className="btn-link" onClick={() => setFilters({ from: null, to: null, cats: [], person: null, keyword: null, venue: null, q: '' })}>
          Wis filters
        </button>
      ) : null}
      <span className="result-label">{fmt(resultCount)} van {fmt(ds.pubs.length)} outputs</span>
    </div>
  );
}
