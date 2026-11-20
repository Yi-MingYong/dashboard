import { useMemo, useState } from 'react';
import { Panel, Seg } from '../components/ui';
import { countBy, keywordTrends, topN, viewYears, yearBuckets } from '../lib/analytics';
import { fmt, fmt1, pct, yearSpan } from '../lib/format';
import type { ViewProps } from './ctx';

export function Topics({ ds, pubs, filters, setFilters }: ViewProps) {
  const [n, setN] = useState(15);
  const [y0, y1] = viewYears(ds, filters);
  const label = (k: string) => ds.keywordLabels.get(k) ?? k;

  const counts = useMemo(() => countBy(pubs, (p) => p.keywords), [pubs]);
  const top = useMemo(() => topN(counts, n), [counts, n]);
  const withKw = pubs.filter((p) => p.keywords.length).length;

  // Older Pure records rarely carry keywords: start at the first year that has them.
  const kwYears = pubs.filter((p) => p.keywords.length && p.year != null).map((p) => p.year!);
  const hy0 = kwYears.length ? Math.max(y0, Math.min(...kwYears)) : y0;
  const buckets = yearBuckets(hy0, y1, 16);
  const matrix = useMemo(() => {
    const idx = new Map(top.map(([k], i) => [k, i]));
    const m = top.map(() => buckets.map(() => 0));
    for (const p of pubs) {
      if (p.year == null) continue;
      const bi = buckets.findIndex((b) => p.year! >= b.from && p.year! <= b.to);
      if (bi < 0) continue;
      for (const k of p.keywords) {
        const ri = idx.get(k);
        if (ri != null) m[ri][bi]++;
      }
    }
    return m;
  }, [pubs, top, hy0, y1]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...matrix.flat());
  const cols = `minmax(120px, 200px) repeat(${buckets.length}, minmax(34px, 1fr))`;

  const trends = useMemo(() => keywordTrends(pubs, y1, 3, 4), [pubs, y1]);
  const rising = trends.filter((r) => r.change > 0).slice(0, 25);
  const falling = [...trends].filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, 25);
  const trendSub = `${yearSpan(y1 - 2, y1)} vs ${yearSpan(hy0, y1 - 3)}`;

  return (
    <div className="view pad topics">
      <Panel
        title="Trefwoorden door de tijd"
        sub={`Aantal outputs per ${buckets[0] && buckets[0].from !== buckets[0].to ? 'periode' : 'jaar'} · ${fmt(counts.size)} trefwoorden · ${pct(pubs.length ? withKw / pubs.length : 0)} van de outputs heeft trefwoorden`}
        actions={<Seg label="Aantal trefwoorden" value={n} onChange={setN} options={[10, 15, 25, 50].map((v) => ({ value: v, label: String(v) }))} />}
        bodyClass="padded"
      >
        {top.length ? (
          <div className="heat" role="table" aria-label="Trefwoorden per jaar">
            <div className="heat-row heat-head" role="row" style={{ gridTemplateColumns: cols }}>
              <span role="columnheader" />
              {buckets.map((b) => <span key={b.label} role="columnheader">{b.label}</span>)}
            </div>
            {top.map(([k, total], ri) => (
              <div className="heat-row" role="row" key={k} style={{ gridTemplateColumns: cols }}>
                <button type="button" className="heat-label" role="rowheader" aria-pressed={filters.keyword === k} title={`${label(k)} · ${total} outputs — klik om te filteren`} onClick={() => setFilters({ keyword: filters.keyword === k ? null : k })}>
                  {label(k)}
                </button>
                {matrix[ri].map((v, ci) => {
                  const a = Math.min(1, v / max);
                  return (
                    <span
                      key={ci}
                      role="cell"
                      className="heat-cell"
                      title={`${label(k)} · ${buckets[ci].label}: ${v}`}
                      style={{ background: v ? `rgba(200,16,46,${(0.08 + a * 0.85).toFixed(2)})` : 'var(--panel-2)', color: a > 0.45 ? '#fff' : 'var(--ink)' }}
                    >
                      {v || '–'}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Geen trefwoorden in deze selectie.</div>
        )}
      </Panel>
      <div className="topics-side">
        <Panel title="Opkomende thema's" sub={trendSub}>
          {rising.length ? rising.map((r) => (
            <button key={r.key} type="button" className="row plain" onClick={() => setFilters({ keyword: r.key })} title={`${fmt1(r.earlierShare)}% → ${fmt1(r.recentShare)}% van de outputs met trefwoorden`}>
              <span className="ellipsis">{label(r.key)}</span>
              <span className="change up">+{fmt1(r.change)} pp</span>
            </button>
          )) : <div className="empty">Kies een periode van minimaal 4 jaar.</div>}
        </Panel>
        <Panel title="Afnemend" sub={trendSub}>
          {falling.length ? falling.map((r) => (
            <button key={r.key} type="button" className="row plain" onClick={() => setFilters({ keyword: r.key })} title={`${fmt1(r.earlierShare)}% → ${fmt1(r.recentShare)}% van de outputs met trefwoorden`}>
              <span className="ellipsis">{label(r.key)}</span>
              <span className="change down">−{fmt1(Math.abs(r.change))} pp</span>
            </button>
          )) : <div className="empty">Kies een periode van minimaal 4 jaar.</div>}
        </Panel>
      </div>
    </div>
  );
}
