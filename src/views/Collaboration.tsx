import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart';
import { columns, lineYears, network } from '../charts/options';
import { useTokens } from '../charts/theme';
import { DataTable, KpiStrip, Panel, Seg, TableToggle } from '../components/ui';
import { coauthorNetwork, range, teamSizeBuckets, viewYears } from '../lib/analytics';
import { fmt, fmt1, pct } from '../lib/format';
import type { ViewProps } from './ctx';

export function Collaboration({ ds, pubs, filters, openPerson }: ViewProps) {
  const t = useTokens();
  const [n, setN] = useState(50);
  const [table, setTable] = useState(false);
  const [y0, y1] = viewYears(ds, filters);
  const years = range(y0, y1);

  const net = useMemo(() => coauthorNetwork(pubs, n), [pubs, n]);
  const netOption = useMemo(
    () => network(t, net.nodes.map((x) => ({ ...x, name: ds.people.get(x.id)?.name ?? x.id })), net.links, filters.person),
    [t, net, ds, filters.person],
  );

  const withAuthors = pubs.filter((p) => p.authorCount > 0);
  const avgByYear = years.map((y) => {
    const xs = withAuthors.filter((p) => p.year === y);
    return xs.length ? xs.reduce((a, p) => a + p.authorCount, 0) / xs.length : null;
  });
  const lineOption = useMemo(() => lineYears(t, years, avgByYear, 'Gem. auteurs per output'), [t, pubs, y0, y1]); // eslint-disable-line react-hooks/exhaustive-deps
  const buckets = teamSizeBuckets(pubs);
  const bucketOption = useMemo(() => columns(t, buckets.map((b) => b.label), buckets.map((b) => b.count), 'Outputs', { valueLabels: true }), [t, pubs]); // eslint-disable-line react-hooks/exhaustive-deps

  const solo = withAuthors.filter((p) => p.authorCount === 1).length;
  const large = withAuthors.filter((p) => p.authorCount >= 6).length;
  const avg = withAuthors.length ? withAuthors.reduce((a, p) => a + p.authorCount, 0) / withAuthors.length : 0;

  const pairs = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pubs) {
      if (p.authors.length > 25) continue;
      const as = [...p.authors].sort();
      for (let i = 0; i < as.length; i++) for (let j = i + 1; j < as.length; j++) {
        const k = `${as[i]}\u0000${as[j]}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return { top: [...m].sort((a, b) => b[1] - a[1]).slice(0, 100), total: m.size, repeat: [...m.values()].filter((v) => v >= 3).length };
  }, [pubs]);
  const maxPair = pairs.top[0]?.[1] ?? 1;

  return (
    <div className="view split">
      <div className="master collab">
        <Panel
          className="flat"
          title="Co-auteursnetwerk"
          sub={`${n} meest productieve auteurs · lijndikte = gezamenlijke outputs · sleep, zoom, klik voor profiel`}
          actions={
            <>
              <Seg label="Aantal personen" value={n} onChange={setN} options={[25, 50, 100].map((v) => ({ value: v, label: String(v) }))} />
              <TableToggle on={table} set={setTable} />
            </>
          }
        >
          {net.nodes.length < 2 ? (
            <div className="empty">Te weinig auteurs in deze selectie voor een netwerk.</div>
          ) : table ? (
            <DataTable
              spec={{
                columns: [{ key: 'a', label: 'Auteur' }, { key: 'b', label: 'Co-auteur' }, { key: 'n', label: 'Samen', align: 'r' }],
                rows: [...net.links].sort((a, b) => b.weight - a.weight).slice(0, 300).map((l) => ({ a: ds.people.get(l.source)?.name, b: ds.people.get(l.target)?.name, n: fmt(l.weight) })),
              }}
            />
          ) : (
            <div style={{ height: '100%', minHeight: 320 }}>
              <EChart option={netOption} height="100%" label="Netwerkdiagram van samenwerkingen tussen auteurs" onClick={(p) => p.dataType === 'node' && openPerson((p.data as { id: string }).id)} />
            </div>
          )}
        </Panel>
        <Panel className="flat" title="Sterkste samenwerkingen" sub={`${fmt(pairs.total)} unieke paren · ${fmt(pairs.repeat)} met 3+ outputs`}>
          {pairs.top.length ? (
            <ol className="rows">
              {pairs.top.map(([k, v], i) => {
                const [a, b] = k.split('\u0000');
                return (
                  <li key={k} className="row rank" style={{ gridTemplateColumns: '22px minmax(0,1fr) 90px 34px' }}>
                    <span className="r">{String(i + 1).padStart(2, '0')}</span>
                    <span className="ellipsis">
                      <button type="button" className="text-btn" onClick={() => openPerson(a)}>{ds.people.get(a)?.name}</button>
                      <span className="muted"> &amp; </span>
                      <button type="button" className="text-btn" onClick={() => openPerson(b)}>{ds.people.get(b)?.name}</button>
                    </span>
                    <span className="track"><span style={{ width: `${(v / maxPair) * 100}%` }} /></span>
                    <span className="v">{fmt(v)}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="empty">Geen samenwerkingen in deze selectie.</div>
          )}
        </Panel>
      </div>
      <aside className="inspector" aria-label="Teamstatistieken">
        <div className="insp-head">
          <div className="insp-kicker">Samenwerking</div>
          <h2 className="insp-title">Teams in de selectie</h2>
        </div>
        <KpiStrip
          className="k4 insp-kpis"
          items={[
            { label: 'Gem. auteurs', value: fmt1(avg), note: 'per output' },
            { label: 'Solo', value: fmt(solo), note: withAuthors.length ? pct(solo / withAuthors.length) : undefined },
            { label: 'Teams 6+', value: fmt(large), note: withAuthors.length ? pct(large / withAuthors.length) : undefined },
            { label: 'Paren', value: fmt(pairs.total), note: 'uniek' },
          ]}
        />
        <section className="insp-sec">
          <div className="caps">Teamgrootte door de tijd</div>
          <EChart option={lineOption} height={170} label="Gemiddeld aantal auteurs per output per jaar" />
        </section>
        <section className="insp-sec">
          <div className="caps">Verdeling teamgrootte</div>
          <EChart option={bucketOption} height={180} label={`Aantal outputs naar aantal auteurs: ${buckets.map((b) => `${b.label} auteurs ${b.count}`).join(', ')}`} />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Aantal auteurs per output (x-as) · aantal outputs (boven de staaf)</div>
        </section>
      </aside>
    </div>
  );
}
