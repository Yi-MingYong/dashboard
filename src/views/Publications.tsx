import { useEffect, useMemo, useRef, useState } from 'react';
import { useListKeys } from '../components/ui';
import { fmt } from '../lib/format';
import type { Publication } from '../lib/model';
import { groupColor, type ViewProps } from './ctx';
import { PubInspector } from './Inspectors';

type SortKey = 'year' | 'title' | 'type' | 'venue';

export function authorLine(ds: ViewProps['ds'], p: Publication, max = 6): string {
  const names = p.authors.map((a) => ds.people.get(a)?.name ?? a);
  if (!names.length) return p.editors.length ? `Red. ${p.editors.slice(0, 3).join(', ')}${p.editors.length > 3 ? ' e.a.' : ''}` : 'Geen auteurs vermeld';
  return names.length > max ? `${names.slice(0, max).join(', ')} e.a. (+${names.length - max})` : names.join(', ');
}

const COLS: { key: SortKey; label: string; cls?: string }[] = [
  { key: 'title', label: 'Titel' },
  { key: 'type', label: 'Type', cls: 'hide-sm' },
  { key: 'venue', label: 'Kanaal', cls: 'hide-sm' },
  { key: 'year', label: 'Jaar', cls: 'r' },
];

export function Publications(props: ViewProps) {
  const { ds, pubs, sel, setSel, openPerson, openVenue, setFilters, ws } = props;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'year', dir: -1 });
  const [limit, setLimit] = useState(150);
  const sorted = useMemo(() => {
    const cmp: Record<SortKey, (a: Publication, b: Publication) => number> = {
      year: (a, b) => a.sortDate.localeCompare(b.sortDate),
      title: (a, b) => a.title.localeCompare(b.title, 'nl'),
      type: (a, b) => a.type.localeCompare(b.type, 'nl'),
      venue: (a, b) => (a.venue ?? '~').localeCompare(b.venue ?? '~', 'nl'),
    };
    return [...pubs].sort((a, b) => cmp[sort.key](a, b) * sort.dir || b.sortDate.localeCompare(a.sortDate));
  }, [pubs, sort]);
  useEffect(() => {
    setLimit(150);
  }, [pubs, sort]);

  const selIdx = sel != null ? Number(sel) : null;
  const selected = selIdx != null && Number.isFinite(selIdx) ? ds.pubs[selIdx] : undefined;
  // Default to the first row so the inspector is never empty.
  useEffect(() => {
    if ((!selected || !pubs.includes(selected)) && sorted[0]) setSel(String(sorted[0].idx));
  }, [sorted]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const visible = sorted.slice(0, limit);
  const onKey = useListKeys(visible, selected ?? null, (p) => setSel(String(p.idx)));

  const clickSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'year' ? -1 : 1 }));
  const inspector = useRef<HTMLDivElement>(null);
  const choose = (p: Publication) => {
    setSel(String(p.idx));
    if (window.matchMedia('(max-width: 860px)').matches) setTimeout(() => inspector.current?.scrollIntoView({ behavior: 'smooth' }), 0);
  };

  return (
    <div className="view split">
      <div className="master">
        <div className="panel-body table-focus" tabIndex={0} onKeyDown={onKey} aria-label="Publicatielijst, gebruik pijltjestoetsen">
          {sorted.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={c.cls} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                      <button type="button" onClick={() => clickSort(c.key)}>{c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const on = p === selected;
                  return (
                    <tr key={p.idx} ref={on ? rowRef : undefined} className="sel-row" aria-selected={on} onClick={() => choose(p)}>
                      <td>
                        <div className="t">{p.title}</div>
                        <div className="s">{authorLine(ds, p)}</div>
                      </td>
                      <td className="hide-sm nowrap ink-2">
                        <span className="sw" style={{ background: groupColor(p.category), marginRight: 6, verticalAlign: 1 }} />
                        {p.type}
                      </td>
                      <td className="hide-sm venue">{p.venue ?? '–'}</td>
                      <td className="yr">{p.year ?? '–'}</td>
                    </tr>
                  );
                })}
                {sorted.length > limit && (
                  <tr className="more-row">
                    <td colSpan={4}>
                      <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + 300)}>
                        Toon meer ({fmt(sorted.length - limit)} resterend)
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <div className="empty">Geen publicaties gevonden. Pas de filters aan.</div>
          )}
        </div>
      </div>
      <aside className="inspector" ref={inspector} aria-label="Details publicatie">
        <PubInspector ws={ws} ds={ds} pub={selected && pubs.includes(selected) ? selected : undefined} openPerson={openPerson} openVenue={openVenue} setFilters={setFilters} />
      </aside>
    </div>
  );
}
