import { useEffect, useMemo, useRef, useState } from 'react';
import { Seg, useListKeys } from '../components/ui';
import { applyFilters } from '../lib/analytics';
import { fmt, yearSpan } from '../lib/format';
import type { Publication } from '../lib/model';
import type { ViewProps } from './ctx';
import { VenueInspector } from './Inspectors';

type Kind = 'j' | 'c' | 'p' | 's';

const KINDS: { id: Kind; label: string; sub: string }[] = [
  { id: 'j', label: 'Tijdschriften', sub: 'tijdschriftartikelen per tijdschrift' },
  { id: 'c', label: 'Conferenties', sub: 'edities samengevoegd op acroniem' },
  { id: 'p', label: 'Uitgevers', sub: 'alle outputs per uitgever' },
  { id: 's', label: 'Reeksen', sub: 'boekreeksen zoals LNCS en LNBIP' },
];

const keyOf = (p: Publication, k: Kind) => (k === 'j' ? p.journal : k === 'c' ? p.conference : k === 'p' ? p.publisher : p.series)?.key;

export function Venues({ ds, filters, setFilters, sel, setSel, openPerson, openPub }: ViewProps) {
  const initialKind = (sel?.[0] as Kind) && KINDS.some((k) => k.id === sel?.[0]) ? (sel![0] as Kind) : 'j';
  const [kind, setKind] = useState<Kind>(initialKind);
  useEffect(() => {
    if (sel && sel[0] !== kind && KINDS.some((k) => k.id === sel[0])) setKind(sel[0] as Kind);
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels = { j: ds.journalLabels, c: ds.conferenceLabels, p: ds.publisherLabels, s: ds.seriesLabels }[kind];
  // Rank venues on the selection without the venue filter itself.
  const base = useMemo(() => applyFilters(ds, { ...filters, venue: null }), [ds, filters]);

  const rows = useMemo(() => {
    const m = new Map<string, { count: number; first: number; last: number; isxn?: string }>();
    for (const p of base) {
      const k = keyOf(p, kind);
      if (!k) continue;
      const r = m.get(k) ?? { count: 0, first: Infinity, last: -Infinity };
      r.count++;
      if (p.year) {
        r.first = Math.min(r.first, p.year);
        r.last = Math.max(r.last, p.year);
      }
      if (kind === 'j' && p.isxn && !r.isxn) r.isxn = p.isxn;
      m.set(k, r);
    }
    return [...m].map(([key, r]) => ({ key, v: `${kind}:${key}`, ...r })).sort((a, b) => b.count - a.count || (labels.get(a.key) ?? '').localeCompare(labels.get(b.key) ?? ''));
  }, [base, kind, labels]);

  const selected = rows.find((r) => r.v === sel) ?? null;
  useEffect(() => {
    if ((!sel || sel[0] !== kind || !selected) && rows[0]) setSel(rows[0].v);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const onKey = useListKeys(rows.slice(0, 400), selected, (r) => setSel(r.v));
  const inspector = useRef<HTMLDivElement>(null);
  const choose = (v: string) => {
    setSel(v);
    if (window.matchMedia('(max-width: 860px)').matches) setTimeout(() => inspector.current?.scrollIntoView({ behavior: 'smooth' }), 0);
  };
  const def = KINDS.find((k) => k.id === kind)!;
  const total = rows.reduce((a, r) => a + r.count, 0);
  const top10 = rows.slice(0, 10).reduce((a, r) => a + r.count, 0);

  return (
    <div className="view split">
      <div className="master">
        <header className="panel-head" style={{ paddingRight: 12 }}>
          <Seg label="Soort kanaal" value={kind} onChange={(k) => { setKind(k); setSel(null); }} options={KINDS.map((k) => ({ value: k.id, label: k.label }))} />
          <span className="panel-sub">{fmt(rows.length)} {def.label.toLowerCase()} · {def.sub}</span>
          <span className="spacer" />
          <span className="result-label hide-sm">top 10 = {total ? Math.round((top10 / total) * 100) : 0}% van {fmt(total)}</span>
        </header>
        <div className="panel-body table-focus" tabIndex={0} onKeyDown={onKey} aria-label="Kanalenlijst, gebruik pijltjestoetsen">
          {rows.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Naam</th>
                  <th className="r">Outputs</th>
                  <th className="r hide-sm">Periode</th>
                  {kind === 'j' && <th className="hide-sm">ISSN</th>}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((r, i) => {
                  const on = r.v === sel;
                  return (
                    <tr key={r.key} ref={on ? rowRef : undefined} className="sel-row" aria-selected={on} onClick={() => choose(r.v)}>
                      <td className="mono muted" style={{ fontSize: 11 }}>{String(i + 1).padStart(2, '0')}</td>
                      <td>{labels.get(r.key) ?? r.key}{filters.venue === r.v && <span className="kind" style={{ marginLeft: 8, padding: '1px 4px' }}>FILTER</span>}</td>
                      <td className="r" style={{ fontWeight: 600 }}>{fmt(r.count)}</td>
                      <td className="r hide-sm mono ink-2 nowrap">{Number.isFinite(r.first) ? yearSpan(r.first, r.last) : '–'}</td>
                      {kind === 'j' && <td className="hide-sm mono muted nowrap">{r.isxn ?? '–'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty">Geen {def.label.toLowerCase()} in deze selectie.</div>
          )}
        </div>
      </div>
      <aside className="inspector" ref={inspector} aria-label="Details kanaal">
        <VenueInspector ds={ds} pubs={base} venue={sel && sel[0] === kind ? sel : null} openPerson={openPerson} openPub={openPub} setFilters={setFilters} filtered={!!sel && sel === filters.venue} />
      </aside>
    </div>
  );
}
