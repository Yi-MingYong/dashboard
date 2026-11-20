import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Seg, useListKeys } from '../components/ui';
import { applyFilters, personStats, type PersonStat } from '../lib/analytics';
import { fmt, yearSpan } from '../lib/format';
import { fold } from '../lib/text';
import { memberIds } from '../workspace';
import type { ViewProps } from './ctx';
import { PersonInspector } from './Inspectors';

type Col = 'name' | 'count' | 'journal' | 'conference' | 'coauthors' | 'last';

const COLS: { key: Col; label: string; r?: boolean; hide?: boolean }[] = [
  { key: 'name', label: 'Auteur' },
  { key: 'count', label: 'Outputs', r: true },
  { key: 'journal', label: 'Artikelen', r: true, hide: true },
  { key: 'conference', label: 'Conferentie', r: true, hide: true },
  { key: 'coauthors', label: 'Co-auteurs', r: true, hide: true },
  { key: 'last', label: 'Actief', r: true },
];

export function People({ ds, filters, setFilters, sel, setSel, openPerson, openPub, ws }: ViewProps) {
  const [q, setQ] = useState('');
  const members = useMemo(() => memberIds(ds, ws.members?.names), [ds, ws]);
  const [scope, setScope] = useState<'all' | 'members'>(ws.members ? 'members' : 'all');
  const [min, setMin] = useState(2);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'count', dir: -1 });
  const [limit, setLimit] = useState(150);
  // People are ranked on the selection without the person filter itself.
  const base = useMemo(() => applyFilters(ds, { ...filters, person: null }), [ds, filters]);
  const stats = useMemo(() => personStats(ds, base), [ds, base]);

  const rows = useMemo(() => {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    const list = stats.filter((s) => (scope === 'all' || members.has(s.id)) && (s.count >= min || s.id === filters.person) && terms.every((t) => fold(`${s.name} ${[...(ds.people.get(s.id)?.variants.keys() ?? [])].join(' ')}`).includes(t)));
    const get = (s: PersonStat): string | number => (sort.col === 'name' ? ds.people.get(s.id)?.sortKey ?? s.name : s[sort.col] ?? 0);
    return list.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const c = typeof va === 'string' ? va.localeCompare(String(vb), 'nl') : va - (vb as number);
      return c * sort.dir || b.count - a.count;
    });
  }, [stats, q, min, sort, ds, filters.person, scope, members]);
  useEffect(() => {
    setLimit(150);
  }, [rows]);

  const selected = rows.find((r) => r.id === sel) ?? null;
  useEffect(() => {
    if (!sel && rows[0]) setSel(rows[0].id);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const visible = rows.slice(0, limit);
  const onKey = useListKeys(visible, selected, (r) => setSel(r.id));
  const inspector = useRef<HTMLDivElement>(null);
  const choose = (id: string) => {
    setSel(id);
    if (window.matchMedia('(max-width: 860px)').matches) setTimeout(() => inspector.current?.scrollIntoView({ behavior: 'smooth' }), 0);
  };
  const clickSort = (col: Col) => setSort((s) => (s.col === col ? { col, dir: (s.dir * -1) as 1 | -1 } : { col, dir: col === 'name' ? 1 : -1 }));

  return (
    <div className="view split">
      <div className="master">
        <header className="panel-head" style={{ paddingRight: 12 }}>
          <span className="panel-title">Auteurs</span>
          <span className="panel-sub">{fmt(rows.length)} personen · naamvarianten samengevoegd · incl. externe co-auteurs</span>
          <span className="spacer" />
          <span className="search hide-sm" style={{ width: 200 }}>
            <Icon name="search" size={13} />
            <input className="input" type="search" placeholder="Zoek op naam…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Zoek auteur" style={{ height: 26 }} />
          </span>
          {ws.members && <Seg label="Wie" value={scope} onChange={setScope} options={[{ value: 'members', label: `${ws.members.group}-leden (${members.size})` }, { value: 'all', label: 'Iedereen' }]} />}
          <Seg label="Minimaal aantal outputs" value={min} onChange={setMin} options={[1, 2, 5, 10].map((n) => ({ value: n, label: `${n}+` }))} />
        </header>
        <div className="panel-body table-focus" tabIndex={0} onKeyDown={onKey} aria-label="Auteurslijst, gebruik pijltjestoetsen">
          {rows.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={`${c.r ? 'r' : ''} ${c.hide ? 'hide-sm' : ''}`} aria-sort={sort.col === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                      <button type="button" onClick={() => clickSort(c.key)}>{c.label}{sort.col === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const on = s.id === sel;
                  const variants = ds.people.get(s.id)?.variants.size ?? 1;
                  return (
                    <tr key={s.id} ref={on ? rowRef : undefined} className="sel-row" aria-selected={on} onClick={() => choose(s.id)} onDoubleClick={() => openPerson(s.id)}>
                      <td style={{ fontWeight: 500 }}>
                        {s.name}
                        {members.has(s.id) && scope === 'all' && <span className="kind" style={{ marginLeft: 8, padding: '1px 4px' }}>{ws.members?.group}</span>}
                        {s.id === filters.person && <span className="kind" style={{ marginLeft: 8, padding: '1px 4px' }}>FILTER</span>}
                        {variants > 1 && <span className="muted" style={{ fontSize: 11, marginLeft: 6, fontWeight: 400 }}>{variants} schrijfwijzen</span>}
                      </td>
                      <td className="r" style={{ fontWeight: 600 }}>{fmt(s.count)}</td>
                      <td className="r hide-sm">{fmt(s.journal)}</td>
                      <td className="r hide-sm">{fmt(s.conference)}</td>
                      <td className="r hide-sm">{fmt(s.coauthors)}</td>
                      <td className="r mono ink-2 nowrap">{yearSpan(s.first, s.last)}</td>
                    </tr>
                  );
                })}
                {rows.length > limit && (
                  <tr className="more-row"><td colSpan={6}><button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + 300)}>Toon meer ({fmt(rows.length - limit)} resterend)</button></td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <div className="empty">Geen auteurs gevonden.</div>
          )}
        </div>
      </div>
      <aside className="inspector" ref={inspector} aria-label="Auteursprofiel">
        <PersonInspector ds={ds} pubs={base} id={sel} openPerson={(id) => choose(id)} openPub={openPub} setFilters={setFilters} filtered={!!sel && sel === filters.person} />
      </aside>
    </div>
  );
}
