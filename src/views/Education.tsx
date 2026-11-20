import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart';
import { columns } from '../charts/options';
import { useTokens } from '../charts/theme';
import { Icon } from '../components/Icon';
import { KpiStrip, Panel, Seg } from '../components/ui';
import { APP } from '../config';
import { IEIS_GROUPS } from '../ingest/education';
import type { EctsCourse, EctsPayload } from '../ingest/types';
import { fmt, fmt1 } from '../lib/format';
import { fold } from '../lib/text';

type Sub = 'groepen' | 'vakken' | 'projecten' | 'wijzigingen' | 'instroom';
const r0 = (n: number | null | undefined) => (n == null ? '–' : fmt(Math.round(n)));
const pctDelta = (a: number, b: number) => (b ? `${a >= b ? '+' : '−'}${fmt1(Math.abs(((a - b) / b) * 100))}%` : null);

export function Education({ ects }: { ects: EctsPayload | null }) {
  const t = useTokens();
  const [sub, setSub] = useState<Sub>('groepen');
  const years = ects?.years ?? [];
  const [year, setYear] = useState<number>(years[years.length - 1] ?? 0);
  const [group, setGroup] = useState<string>(APP.focusGroup);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<EctsCourse | null>(null);

  const sums = useMemo(() => {
    const m = new Map<string, Record<number, number>>();
    for (const c of ects?.courses ?? []) {
      const g = IEIS_GROUPS.includes(c.group) ? c.group : c.group === 'F_IE&IS' || c.group.startsWith('School') ? 'Faculteit/School' : 'Overig';
      const row = m.get(g) ?? {};
      for (const y of years) row[y] = (row[y] ?? 0) + (c.years[y]?.ieis ?? 0);
      m.set(g, row);
    }
    return m;
  }, [ects]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartOption = useMemo(() => columns(t, years.map(String), years.map((y) => sums.get(group)?.[y] ?? 0), `IE&IS-ECTS ${group}`, { color: t.red, valueLabels: true }), [t, sums, group]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ects) return <div className="state"><div><Icon name="data" size={22} /><p>Nog geen ECTS-matrix gepubliceerd. Een beheerder voegt die toe via Beheer.</p></div></div>;
  const prev = years[years.indexOf(year) - 1];
  const total = (y: number) => [...sums.values()].reduce((a, r) => a + (r[y] ?? 0), 0);
  const g = (y: number | undefined) => (y == null ? 0 : sums.get(group)?.[y] ?? 0);
  const mine = ects.courses.filter((c) => c.group === group && (c.years[year]?.ieis ?? 0) > 0);
  const groups = [...sums.keys()].sort((a, b) => (sums.get(b)![year] ?? 0) - (sums.get(a)![year] ?? 0));
  const maxG = Math.max(1, ...groups.map((x) => sums.get(x)![year] ?? 0));
  const terms = fold(q).split(/\s+/).filter(Boolean);
  const courses = ects.courses
    .filter((c) => (group === '*' || c.group === group) && terms.every((tt) => fold(`${c.code} ${c.name} ${c.type}`).includes(tt)))
    .sort((a, b) => (b.years[year]?.ieis ?? 0) - (a.years[year]?.ieis ?? 0));
  const projEcts = (p: EctsPayload['projects'][number]) => (p.ects ?? 0) * (p.passed ?? 0) * (p.shares[group] ?? 0);

  return (
    <div className="view pad stack">
      <KpiStrip
        items={[
          { label: `IE&IS-ECTS ${year}`, value: r0(total(year)), ...(prev ? { delta: pctDelta(total(year), total(prev)), up: total(year) >= total(prev) } : {}), note: prev ? `vs ${prev}` : 'alle groepen' },
          { label: `ECTS ${group} ${year}`, value: r0(g(year)), ...(prev ? { delta: pctDelta(g(year), g(prev)), up: g(year) >= g(prev) } : {}), note: prev ? `vs ${prev}` : undefined },
          { label: `Aandeel ${group}`, value: total(year) ? `${fmt1((g(year) / total(year)) * 100)}%` : '–', note: 'van IE&IS-ECTS' },
          { label: `Vakken met ${group}`, value: fmt(mine.length), note: `in ${year}` },
          { label: 'Ingeschreven', value: r0(mine.reduce((a, c) => a + (c.years[year]?.enroll ?? 0), 0)), note: `${group}-vakken` },
          { label: 'Definitief', value: r0(mine.reduce((a, c) => a + (c.years[year]?.passed ?? 0), 0)), note: 'studenten (def. aantal)' },
        ]}
      />
      <div className="filterbar" style={{ border: '1px solid var(--line)' }}>
        <Seg label="Onderdeel" value={sub} onChange={setSub} options={[
          { value: 'groepen', label: 'Groepen' }, { value: 'vakken', label: 'Vakken' }, { value: 'projecten', label: 'Projecten' },
          { value: 'wijzigingen', label: 'Wijzigingen' }, { value: 'instroom', label: 'Instroom' },
        ]} />
        <span className="vsep" />
        <Seg label="Jaar" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: String(y) }))} />
        <select className="select select-sm" aria-label="Groep" value={group} onChange={(e) => setGroup(e.target.value)}>
          {IEIS_GROUPS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <span className="result-label">{ects.sheet} · {ects.checks.length ? (ects.checks.every((c) => c.ok) ? '✓ totalen gecontroleerd' : '✗ controle wijkt af') : 'geen controletabblad'}</span>
      </div>

      {sub === 'groepen' && (
        <div className="ov-grid" style={{ gridTemplateRows: 'auto', minHeight: 0 }}>
          <Panel className="wide" title="IE&IS-ECTS per groep" sub="Som van de IE&IS-kolom per kalenderjaar">
            <table className="tbl">
              <thead><tr><th>Groep</th>{years.map((y) => <th key={y} className="r">{y}</th>)}<th className="r">Δ</th><th style={{ width: '30%' }}>{year}</th></tr></thead>
              <tbody>
                {groups.map((x) => {
                  const row = sums.get(x)!;
                  return (
                    <tr key={x} className="sel-row" aria-selected={x === group} onClick={() => IEIS_GROUPS.includes(x) && setGroup(x)}>
                      <td style={{ fontWeight: x === group ? 600 : 400 }}>{x}</td>
                      {years.map((y) => <td key={y} className="r">{r0(row[y])}</td>)}
                      <td className="r mono">{prev ? pctDelta(row[year] ?? 0, row[prev] ?? 0) ?? '–' : '–'}</td>
                      <td><span className="track" style={{ marginTop: 6 }}><span style={{ width: `${((row[year] ?? 0) / maxG) * 100}%`, background: x === group ? 'var(--red)' : 'var(--slate)' }} /></span></td>
                    </tr>
                  );
                })}
                <tr><td style={{ fontWeight: 600 }}>Totaal</td>{years.map((y) => <td key={y} className="r" style={{ fontWeight: 600 }}>{r0(total(y))}</td>)}<td /><td /></tr>
              </tbody>
            </table>
          </Panel>
          <Panel title={`${group} door de jaren`} sub="IE&IS-ECTS">
            <div style={{ padding: '8px 12px' }}><EChart option={chartOption} height={240} label={`IE&IS-ECTS van ${group} per jaar`} /></div>
            <ul className="prose" style={{ padding: '0 14px 12px 30px', margin: 0 }}>
              {ects.checks.map((c) => <li key={c.label} className={c.ok ? 'up' : 'down'}>{c.ok ? '✓' : '✗'} {c.label}</li>)}
            </ul>
          </Panel>
        </div>
      )}

      {sub === 'vakken' && (
        <div className="split" style={{ minHeight: 480, border: '1px solid var(--line)' }}>
          <div className="master">
            <header className="panel-head" style={{ paddingRight: 12 }}>
              <span className="panel-title">Vakken</span><span className="panel-sub">{fmt(courses.length)} regels · {group}</span><span className="spacer" />
              <span className="search" style={{ width: 220 }}><Icon name="search" size={13} /><input className="input" type="search" placeholder="Code of vaknaam…" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 26 }} /></span>
            </header>
            <div className="panel-body">
              <table className="tbl">
                <thead><tr><th>Code</th><th>Vak</th><th className="hide-sm">Type</th><th className="r">%</th><th className="r">Def. {year}</th><th className="r">IE&IS {year}</th>{prev && <th className="r hide-sm">IE&IS {prev}</th>}</tr></thead>
                <tbody>
                  {courses.slice(0, 400).map((c, i) => (
                    <tr key={`${c.code}${c.group}${i}`} className="sel-row" aria-selected={c === sel} onClick={() => setSel(c)}>
                      <td className="mono nowrap">{c.code}</td><td>{c.name}</td><td className="hide-sm muted">{c.type}</td>
                      <td className="r">{c.share ?? '–'}</td><td className="r">{r0(c.years[year]?.passed)}</td><td className="r" style={{ fontWeight: 600 }}>{r0(c.years[year]?.ieis)}</td>
                      {prev && <td className="r hide-sm">{r0(c.years[prev]?.ieis)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <aside className="inspector">
            {sel ? (
              <>
                <div className="insp-head"><div className="insp-kicker">{sel.code} · {sel.group}</div><h2 className="insp-title">{sel.name}</h2><div className="insp-note">{[sel.type, sel.quartile, sel.semester, sel.sp != null ? `${sel.sp} EC` : ''].filter(Boolean).join(' · ')}</div></div>
                <table className="tbl"><thead><tr><th>Jaar</th><th className="r">Inschr.</th><th className="r">Def.</th><th className="r">ECTS</th><th className="r">IE&IS</th></tr></thead>
                  <tbody>{years.map((y) => <tr key={y}><td>{y}</td><td className="r">{r0(sel.years[y]?.enroll)}</td><td className="r">{r0(sel.years[y]?.passed)}</td><td className="r">{r0(sel.years[y]?.ects)}</td><td className="r">{r0(sel.years[y]?.ieis)}</td></tr>)}</tbody></table>
                <section className="insp-sec"><div className="caps">Verdeling over groepen</div>
                  {ects.courses.filter((c) => c.code === sel.code).map((c, i) => <div key={i} className="type-row"><div className="line"><span>{c.group}</span><span className="num">{c.share ?? '–'}%</span></div></div>)}
                </section>
                {Object.keys(sel.remarks).length > 0 && <section className="insp-sec"><div className="caps">Opmerkingen</div>{Object.entries(sel.remarks).map(([y, r]) => <div key={y} className="ink-2"><span className="mono">{y}</span> · {r}</div>)}</section>}
                {sel.teacher && <section className="insp-sec"><div className="caps">Betrokken docent</div>{sel.teacher}</section>}
              </>
            ) : <div className="insp-empty">Selecteer een vak.</div>}
          </aside>
        </div>
      )}

      {sub === 'projecten' && (
        <Panel title="Projecten en afstuderen" sub={`ECTS × geslaagd × aandeel ${group}`}>
          <table className="tbl"><thead><tr><th>Code</th><th>Naam</th><th>Type</th><th>Coördinerend</th><th className="r">EC</th><th className="r">Geslaagd</th><th className="r">Aandeel {group}</th><th className="r">ECTS {group}</th></tr></thead>
            <tbody>{[...ects.projects].sort((a, b) => projEcts(b) - projEcts(a)).map((p, i) => (
              <tr key={i}><td className="mono">{p.code}</td><td>{p.name}<div className="s">{p.section} · {p.year}{p.comment ? ` · ${p.comment}` : ''}</div></td><td>{p.type}</td><td>{p.coordinator}</td><td className="r">{p.ects ?? '–'}</td><td className="r">{p.passed ?? '–'}</td><td className="r">{p.shares[group] ? `${fmt1(p.shares[group] * 100)}%` : '–'}</td><td className="r" style={{ fontWeight: 600 }}>{r0(projEcts(p))}</td></tr>
            ))}</tbody></table>
        </Panel>
      )}

      {sub === 'wijzigingen' && (
        <Panel title="Nieuwe, gewijzigde en beëindigde vakken" sub={`${ects.changes.length} vakken`}>
          <table className="tbl"><thead><tr><th>Code</th><th>Vak</th><th>Status</th>{(ects.changes[0]?.blocks ?? []).map((b) => <th key={b.year}>Verdeling {b.year}</th>)}<th>Opmerking</th></tr></thead>
            <tbody>{ects.changes.map((c, i) => (
              <tr key={i} style={c.blocks.some((b) => b.allocations.some((a) => a.group === group)) ? { background: 'var(--red-wash)' } : undefined}>
                <td className="mono">{c.code}</td><td>{c.name}</td><td>{c.status}</td>
                {c.blocks.map((b) => <td key={b.year} className="ink-2">{b.allocations.map((a) => `${a.group}${a.pct != null ? ` ${a.pct}%` : ''}`).join(', ') || '–'}{b.approved ? ` · ${b.approved}` : ''}</td>)}
                <td className="muted">{c.remark}</td>
              </tr>
            ))}</tbody></table>
        </Panel>
      )}

      {sub === 'instroom' && (
        <>
          {ects.enrollment[0] && (
            <Panel title={`Ingeschreven studenten · peildatum ${ects.enrollment[0].label}`} sub={`${ects.enrollment.length} peildata in bestand`}>
              <div className="table-scroll" style={{ overflowX: 'auto' }}>
                <table className="tbl"><thead><tr><th>Cohort</th>{ects.enrollment[0].programs.map((p) => <th key={p} className="r">{p}</th>)}</tr></thead>
                  <tbody>
                    {ects.enrollment[0].cohorts.map((c) => <tr key={c.cohort}><td className="mono">{c.cohort}</td>{c.values.map((v, i) => <td key={i} className="r">{v ?? ''}</td>)}</tr>)}
                    <tr><td style={{ fontWeight: 600 }}>Totaal</td>{ects.enrollment[0].total.map((v, i) => <td key={i} className="r" style={{ fontWeight: 600 }}>{v ?? ''}</td>)}</tr>
                  </tbody></table>
              </div>
            </Panel>
          )}
          {ects.bep && (
            <Panel title="BEP-prognose" sub={ects.bep.title}>
              <table className="tbl"><thead><tr>{ects.bep.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{ects.bep.rows.map((r, i) => <tr key={i} style={r[0] === group ? { background: 'var(--red-wash)' } : undefined}>{r.map((v, j) => <td key={j} className={j ? 'r' : ''}>{v ?? ''}</td>)}</tr>)}</tbody></table>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
