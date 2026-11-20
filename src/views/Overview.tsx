import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart';
import { stackedYears } from '../charts/options';
import { useTokens } from '../charts/theme';
import { DataTable, KpiStrip, Panel, RankRows, TableToggle, type KpiItem } from '../components/ui';
import { applyFilters, countBy, kpis, previousPeriod, range, topN, viewYears } from '../lib/analytics';
import { fmt, fmt1, yearSpan } from '../lib/format';
import { GROUPS, groupOf, type ViewProps } from './ctx';

const signPct = (d: number) => `${d >= 0 ? '+' : '−'}${fmt1(Math.abs(d * 100))}%`;
const signAbs = (d: number) => `${d >= 0 ? '+' : '−'}${fmt1(Math.abs(d))}`;

export function Overview({ ds, pubs, filters, setFilters, openPerson, openPub, openVenue, goTab }: ViewProps) {
  const t = useTokens();
  const [table, setTable] = useState(false);
  const [y0, y1] = viewYears(ds, filters);
  const years = range(y0, y1);
  const span = yearSpan(y0, y1);

  const k = useMemo(() => kpis(pubs), [pubs]);
  const prev = previousPeriod(ds, filters);
  const kp = useMemo(() => (prev ? kpis(applyFilters(ds, { ...filters, from: prev[0], to: prev[1] })) : null), [ds, filters, prev?.[0], prev?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const vs = prev ? `vs ${yearSpan(prev[0], prev[1])}` : undefined;
  const rel = (a: number, b?: number) => (kp && b ? { delta: signPct((a - b) / b), up: a >= b } : {});
  const share = (n: number) => (k.total ? `${Math.round((n / k.total) * 100)}% van output` : undefined);

  const items: KpiItem[] = [
    { label: 'Research output', value: fmt(k.total), ...rel(k.total, kp?.total), note: vs ?? span },
    { label: 'Tijdschriftartikelen', value: fmt(k.journal), ...rel(k.journal, kp?.journal), note: share(k.journal) },
    { label: 'Conferentiebijdragen', value: fmt(k.conference), ...rel(k.conference, kp?.conference), note: share(k.conference) },
    { label: 'Proefschriften', value: fmt(k.thesis), ...rel(k.thesis, kp?.thesis), note: 'promoties' },
    { label: 'Unieke auteurs', value: fmt(k.people), ...rel(k.people, kp?.people), note: 'incl. extern' },
    {
      label: 'Gem. auteurs per output', value: fmt1(k.teamSize),
      ...(kp && kp.teamSize ? { delta: signAbs(k.teamSize - kp.teamSize), up: k.teamSize >= kp.teamSize } : {}), note: 'teamgrootte',
    },
  ];

  const byGroup = useMemo(() => {
    const idx = new Map(years.map((y, i) => [y, i]));
    const out = Object.fromEntries(GROUPS.map((g) => [g.id, years.map(() => 0)])) as Record<string, number[]>;
    for (const p of pubs) {
      const i = p.year == null ? undefined : idx.get(p.year);
      if (i != null) out[groupOf(p.category)][i]++;
    }
    return out;
  }, [pubs, y0, y1]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = GROUPS.map((g) => ({ name: g.label, color: t[g.token], data: byGroup[g.id] }));
  const option = useMemo(() => stackedYears(t, years, series), [t, byGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const types = topN(countBy(pubs, (p) => p.type), 40);
  const typeMax = types[0]?.[1] ?? 1;
  const authors = topN(countBy(pubs, (p) => p.authors), 50).map(([id, value]) => ({ key: id, label: ds.people.get(id)?.name ?? id, value }));
  const venues = useMemo(() => {
    const j = topN(countBy(pubs, (p) => p.journal?.key), 40).map(([key, n]) => ({ v: `j:${key}`, kind: 'JOUR', name: ds.journalLabels.get(key) ?? key, n }));
    const c = topN(countBy(pubs, (p) => p.conference?.key), 40).map(([key, n]) => ({ v: `c:${key}`, kind: 'CONF', name: ds.conferenceLabels.get(key) ?? key, n }));
    return [...j, ...c].sort((a, b) => b.n - a.n).slice(0, 40);
  }, [pubs, ds]);
  const recent = useMemo(() => [...pubs].sort((a, b) => b.sortDate.localeCompare(a.sortDate)).slice(0, 30), [pubs]);

  return (
    <div className="view pad">
      <KpiStrip items={items} />
      <div className="ov-grid">
        <Panel
          className="wide"
          title="Output per jaar"
          sub={`Naar type · ${span}${y1 >= new Date().getFullYear() ? ' · * lopend jaar' : ''}`}
          actions={
            <>
              <span className="legend hide-sm" style={{ marginRight: 8 }}>
                {GROUPS.map((g) => <span key={g.id}><span className="sw" style={{ background: g.color }} />{g.label}</span>)}
              </span>
              <TableToggle on={table} set={setTable} />
            </>
          }
          bodyClass={table ? '' : 'chart-body'}
        >
          {!pubs.length ? (
            <div className="empty">Geen output in deze selectie.</div>
          ) : table ? (
            <DataTable
              spec={{
                columns: [{ key: 'y', label: 'Jaar' }, ...GROUPS.map((g) => ({ key: g.id, label: g.label, align: 'r' as const })), { key: 't', label: 'Totaal', align: 'r' as const }],
                rows: years.map((y, i) => ({
                  y,
                  ...Object.fromEntries(GROUPS.map((g) => [g.id, fmt(byGroup[g.id][i])])),
                  t: fmt(GROUPS.reduce((a, g) => a + byGroup[g.id][i], 0)),
                })),
              }}
            />
          ) : (
            <div style={{ height: '100%', minHeight: 220, padding: '10px 14px 8px 8px' }}>
              <EChart
                option={option}
                height="100%"
                label={`Gestapelde staafgrafiek van output per jaar, ${span}`}
                onClick={(p) => {
                  const y = Number(String(p.name).replace('*', ''));
                  if (Number.isFinite(y)) setFilters({ from: y, to: y });
                }}
              />
            </div>
          )}
        </Panel>

        <Panel title="Verdeling naar type" bodyClass="padded" >
          {types.length ? types.map(([label, v]) => (
            <div className="type-row" key={label}>
              <div className="line"><span>{label}</span><span className="num" style={{ fontWeight: 600 }}>{fmt(v)}</span></div>
              <div className="track slate"><span style={{ width: `${(v / typeMax) * 100}%` }} /></div>
            </div>
          )) : <div className="empty">Geen output.</div>}
        </Panel>

        <Panel title="Meest productieve auteurs" actions={<button type="button" className="btn-link" onClick={() => goTab('auteurs')}>Alle →</button>}>
          <RankRows items={authors} onSelect={openPerson} limit={50} />
        </Panel>

        <Panel title="Top kanalen" actions={<button type="button" className="btn-link" onClick={() => goTab('kanalen')}>Alle →</button>}>
          {venues.length ? (
            <ol className="rows">
              {venues.map((v) => (
                <li key={v.v}>
                  <button type="button" className="row venue" onClick={() => openVenue(v.v)}>
                    <span className="kind">{v.kind}</span>
                    <span className="ellipsis" title={v.name}>{v.name}</span>
                    <span className="v">{fmt(v.n)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <div className="empty">Geen kanalen in deze selectie.</div>}
        </Panel>

        <Panel title="Recent verschenen" actions={<button type="button" className="btn-link" onClick={() => goTab('publicaties')}>Alle →</button>}>
          {recent.length ? recent.map((p) => (
            <button key={p.idx} type="button" className="pub-btn" onClick={() => openPub(p.idx)}>
              <div className="t">{p.title}</div>
              <div className="m">{[p.year ?? '–', p.type, p.venue].filter(Boolean).join(' · ')}</div>
            </button>
          )) : <div className="empty">Geen output in deze selectie.</div>}
        </Panel>
      </div>
    </div>
  );
}
