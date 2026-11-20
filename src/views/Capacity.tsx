import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart';
import { stackedYears } from '../charts/options';
import { useTokens } from '../charts/theme';
import { Icon } from '../components/Icon';
import { KpiStrip, Panel, Seg } from '../components/ui';
import type { CapacityPayload } from '../ingest/types';
import { fmt, fmt1 } from '../lib/format';

const r0 = (n: number | null | undefined) => (n == null ? '–' : fmt(Math.round(n)));

function currentAy(years: string[]): string {
  const now = new Date();
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return years.find((y) => y.startsWith(String(start))) ?? years[0];
}

export function Capacity({ cap }: { cap: CapacityPayload | null }) {
  const t = useTokens();
  const sectionYears = useMemo(() => [...new Set((cap?.sections ?? []).flatMap((s) => s.rows.flatMap((r) => Object.values(r.values).flatMap((v) => Object.keys(v)))))].sort(), [cap]);
  const [ay, setAy] = useState(() => currentAy(sectionYears));
  const find = (title: RegExp, label: RegExp, group?: RegExp) => {
    const s = cap?.sections.find((x) => title.test(x.title));
    const row = s?.rows.find((r) => label.test(r.label));
    if (!row) return {};
    const g = Object.keys(row.values).find((k) => !group || group.test(k)) ?? Object.keys(row.values)[0];
    return row.values[g] ?? {};
  };
  const req = { edu: find(/requir/i, /education/i), res: find(/requir/i, /research/i), man: find(/requir/i, /management/i), tot: find(/requir/i, /^total/i) };
  const avail = find(/availab/i, /^total/i, /uren/i);
  const staffFte = find(/availab/i, /staff \(total\)/i, /fte/i);
  const phdFte = find(/availab/i, /phd/i, /fte/i);
  const occ = find(/metric/i, /occupancy/i);
  const surplus = find(/metric/i, /surplus|total capacity/i);
  const option = useMemo(() => stackedYears(t, sectionYears.map((y) => Number(y.slice(0, 4))), [
    { name: 'Onderwijs', color: t.red, data: sectionYears.map((y) => req.edu[y] ?? 0) },
    { name: 'Onderzoek', color: t.slate, data: sectionYears.map((y) => req.res[y] ?? 0) },
    { name: 'Management', color: t.gray, data: sectionYears.map((y) => req.man[y] ?? 0) },
  ]), [t, cap]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sort, setSort] = useState<'hours' | 'name'>('hours');

  if (!cap) return <div className="state"><div><Icon name="data" size={22} /><p>Nog geen capaciteitsmodel gepubliceerd. Een beheerder voegt het toe via Beheer.</p></div></div>;
  const hoursKey = cap.courseGroups.find((g) => /uren/i.test(g)) ?? cap.courseGroups[0];
  const enrolKey = cap.courseGroups.find((g) => /inschr/i.test(g));
  const courses = [...cap.courses].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b.values[hoursKey]?.[ay] ?? 0) - (a.values[hoursKey]?.[ay] ?? 0)));
  const nowAy = currentAy(sectionYears);

  return (
    <div className="view pad stack">
      <KpiStrip
        items={[
          { label: `Benodigd ${ay}`, value: r0(req.tot[ay]), note: 'uren' },
          { label: `Beschikbaar ${ay}`, value: r0(avail[ay]), note: 'uren' },
          { label: 'Over / tekort', value: r0(surplus[ay]), up: (surplus[ay] ?? 0) >= 0, delta: surplus[ay] != null ? ((surplus[ay] ?? 0) >= 0 ? 'overschot' : 'tekort') : null },
          { label: 'Bezetting staf', value: occ[ay] != null ? `${fmt1((occ[ay] ?? 0) * 100)}%` : '–', note: 'benodigd / beschikbaar' },
          { label: 'Staf', value: staffFte[ay] != null ? fmt1(staffFte[ay]!) : '–', note: 'FTE' },
          { label: 'Promovendi', value: phdFte[ay] != null ? fmt(phdFte[ay]!) : '–', note: 'aantal / FTE' },
        ]}
      />
      <div className="filterbar" style={{ border: '1px solid var(--line)' }}>
        <span className="caps">Academisch jaar</span>
        <Seg label="Academisch jaar" value={ay} onChange={setAy} options={sectionYears.map((y) => ({ value: y, label: `${y}${y > nowAy ? '*' : ''}` }))} />
        <span className="result-label">* prognose · bron: capaciteitsmodel</span>
      </div>
      <div className="ov-grid" style={{ gridTemplateRows: 'auto', minHeight: 0 }}>
        <Panel className="wide" title="Benodigde uren per academisch jaar" sub="Onderwijs, onderzoek en management (startjaar op de as)">
          <div style={{ padding: '8px 12px' }}><EChart option={option} height={260} label="Benodigde capaciteit per academisch jaar" /></div>
        </Panel>
        <Panel title="Capaciteit vs behoefte" sub="uren">
          <table className="tbl"><thead><tr><th>Jaar</th><th className="r">Benodigd</th><th className="r">Beschikbaar</th><th className="r">Saldo</th></tr></thead>
            <tbody>{sectionYears.map((y) => <tr key={y} aria-selected={y === ay}><td className="mono">{y}{y > nowAy ? '*' : ''}</td><td className="r">{r0(req.tot[y])}</td><td className="r">{r0(avail[y])}</td><td className={`r ${(surplus[y] ?? 0) >= 0 ? 'up' : 'down'}`}>{r0(surplus[y])}</td></tr>)}</tbody></table>
        </Panel>
      </div>
      <Panel title="Onderwijsbehoefte per vak" sub={`${cap.courses.length} vakken en taken · ${ay}`} actions={<Seg label="Sorteer" value={sort} onChange={setSort} options={[{ value: 'hours', label: 'Uren' }, { value: 'name', label: 'Naam' }]} />}>
        <table className="tbl"><thead><tr><th>Code</th><th>Vak / taak</th><th className="hide-sm">Driver</th><th className="r hide-sm">Ons aandeel</th>{enrolKey && <th className="r">Studenten</th>}<th className="r">Uren</th></tr></thead>
          <tbody>{courses.map((c, i) => <tr key={i}><td className="mono">{c.code || '–'}</td><td>{c.name}</td><td className="muted hide-sm">{c.driver}</td><td className="r hide-sm">{c.share != null ? `${fmt(c.share * 100)}%` : '–'}</td>{enrolKey && <td className="r">{r0(c.values[enrolKey]?.[ay])}</td>}<td className="r" style={{ fontWeight: 600 }}>{r0(c.values[hoursKey]?.[ay])}</td></tr>)}</tbody></table>
      </Panel>
      {cap.cohorts.series.length > 0 && (
        <Panel title="Instroom en cohorten" sub={`Aannames: ${cap.assumptions.map((a) => `${a.label} ${a.text}`).join(' · ') || '–'}`}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl"><thead><tr><th>Reeks</th>{cap.cohorts.years.map((y) => <th key={y} className="r">{y}{y > nowAy ? '*' : ''}</th>)}</tr></thead>
              <tbody>{cap.cohorts.series.map((s) => <tr key={s.label}><td>{s.label}</td>{s.values.map((v, i) => <td key={i} className="r">{r0(v)}</td>)}</tr>)}</tbody></table>
          </div>
        </Panel>
      )}
      {cap.notes.length > 0 && <Panel title="Toelichting uit het model"><ul className="prose" style={{ margin: 0, padding: '10px 14px 12px 32px' }}>{cap.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Panel>}
    </div>
  );
}
