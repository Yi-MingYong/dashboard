import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { completeness, countBy } from '../lib/analytics';
import { fmt, pct } from '../lib/format';
import { fold } from '../lib/text';
import { CATEGORY_BY_ID, classifyType } from '../lib/types';
import type { ManifestEntry } from '../workspace';
import { groupColor, type ViewProps } from './ctx';

export function DataQuality({ ds, pubs, openPerson, entries, onImport }: ViewProps & {
  entries: ManifestEntry[]; onImport?: (f: File) => void;
}) {
  const c = useMemo(() => completeness(pubs), [pubs]);
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const merged = useMemo(
    () =>
      [...ds.people.values()]
        .filter((p) => p.variants.size > 1)
        .filter((p) => !q || fold(`${p.name} ${[...p.variants.keys()].join(' ')}`).includes(fold(q)))
        .sort((a, b) => b.count - a.count),
    [ds, q],
  );
  const rawTypes = useMemo(() => [...countBy(ds.pubs, (p) => p.rawType)].sort((a, b) => b[1] - a[1]), [ds]);
  const meters: [string, { count: number; share: number }][] = [
    ['DOI', c.doi], ['Abstract', c.abstract], ['Trefwoorden', c.keywords], ['Kanaal', c.venue],
    ['ISSN / ISBN', c.isxn], ['Scopus-koppeling', c.scopus], ['Auteur(s)', c.authors],
  ];

  return (
    <div className="view split">
      <div className="master">
        <header className="panel-head" style={{ paddingRight: 12 }}>
          <span className="panel-title">Samengevoegde naamvarianten</span>
          <span className="panel-sub">{fmt(merged.length)} personen met meerdere schrijfwijzen · {fmt(ds.mergedNames)} varianten samengevoegd · corrigeer via data/aliases.json</span>
          <span className="spacer" />
          <span className="search" style={{ width: 220 }}>
            <Icon name="search" size={13} />
            <input className="input" type="search" placeholder="Zoek persoon of schrijfwijze…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Zoek naamvariant" style={{ height: 26 }} />
          </span>
        </header>
        <div className="panel-body">
          <table className="tbl">
            <thead>
              <tr><th>Getoond als</th><th>Schrijfwijzen in Pure</th><th className="r">Outputs</th></tr>
            </thead>
            <tbody>
              {merged.slice(0, 500).map((p) => (
                <tr key={p.id} className="sel-row" onClick={() => openPerson(p.id)}>
                  <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td className="ink-2" style={{ fontSize: 12 }}>
                    {[...p.variants].sort((a, b) => b[1] - a[1]).map(([v, n]) => (
                      <span key={v} className="nowrap" style={{ marginRight: 12 }}>{v} <span className="mono muted" style={{ fontSize: 10.5 }}>{n}</span></span>
                    ))}
                  </td>
                  <td className="r" style={{ fontWeight: 600 }}>{fmt(p.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!merged.length && <div className="empty">Geen samengevoegde namen gevonden.</div>}
        </div>
      </div>
      <aside className="inspector" aria-label="Datakwaliteit en bronnen">
        <div className="insp-head">
          <div className="insp-kicker">Data &amp; kwaliteit</div>
          <h2 className="insp-title">{ds.meta.label}</h2>
          <div className="insp-note mono">
            {ds.meta.source} · {fmt(ds.pubs.length)} records
            {ds.meta.generatedAt && !ds.meta.imported ? ` · verwerkt ${new Date(ds.meta.generatedAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
          </div>
        </div>
        <section className="insp-sec">
          <div className="caps">Volledigheid metadata · {fmt(pubs.length)} outputs</div>
          {meters.map(([label, v]) => (
            <div className="meter-row" key={label}>
              <span>{label}</span>
              <span className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.share * 100)}><span style={{ width: `${v.share * 100}%` }} /></span>
              <span className="mono" style={{ textAlign: 'right', fontSize: 11.5 }}>{pct(v.share)} <span className="muted">{fmt(v.count)}</span></span>
            </div>
          ))}
        </section>
        <section className="insp-sec">
          <div className="caps">Databronnen</div>
          {entries.map((e) => (
            <div key={e.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line-3)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 500, flex: 1 }}>{e.label}</span>
                {e.id === ds.meta.id && <span className="kind" style={{ padding: '1px 4px' }}>ACTIEF</span>}
                <span className="mono muted" style={{ fontSize: 11 }}>{fmt(e.records)}</span>
              </div>
              <div className="mono muted" style={{ fontSize: 11 }}>{e.source} · {e.yearMin ?? '–'}–{e.yearMax ?? '–'}</div>
              {e.description && <div className="ink-2" style={{ fontSize: 12, marginTop: 2 }}>{e.description}</div>}
            </div>
          ))}
          {onImport && (
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              style={{ marginTop: 12 }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onImport(f); }}
            >
              Sleep een Pure RIS-export hierheen of{' '}
              <button type="button" className="btn-link" style={{ padding: 0, fontSize: 12.5 }} onClick={() => input.current?.click()}>kies een bestand</button>.
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Wordt in je browser gelezen; in Beheer kies je of je het publiceert.</div>
              <input ref={input} type="file" accept=".ris,.txt,application/x-research-info-systems" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            </div>
          )}
        </section>
        <section className="insp-sec" style={{ padding: '14px 0 0' }}>
          <div className="caps" style={{ padding: '0 18px' }}>Typen in Pure</div>
          <table className="tbl">
            <tbody>
              {rawTypes.map(([raw, n]) => {
                const rule = classifyType(raw, undefined);
                return (
                  <tr key={raw}>
                    <td>{raw}</td>
                    <td className="nowrap ink-2"><span className="sw" style={{ background: groupColor(rule.category), marginRight: 6 }} />{CATEGORY_BY_ID[rule.category].short}</td>
                    <td className="r">{fmt(n)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="insp-sec prose" style={{ borderBottom: 0 }}>
          <div className="caps">Data bijwerken</div>
          <ol>
            <li>Exporteer de onderzoeksoutput in Pure als RIS.</li>
            <li>Zet het bestand in <code>data/raw/</code> (optioneel met label in <code>data/datasets.json</code>).</li>
            <li>Commit en push; Vercel bouwt het dashboard en de data opnieuw.</li>
          </ol>
          Roepnamen en andere naamuitzonderingen leg je vast in <code>data/aliases.json</code>.
        </section>
      </aside>
    </div>
  );
}
