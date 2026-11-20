import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EChart } from '../charts/EChart';
import { columns, CURRENT_YEAR } from '../charts/options';
import { useTokens } from '../charts/theme';
import { Icon } from '../components/Icon';
import { RankRows, SegBar } from '../components/ui';
import { coauthors, countBy, range, topN, venueLabel, venueMatches, type Filters } from '../lib/analytics';
import { download, toBibtex, toRis } from '../lib/export';
import { fmt, yearSpan } from '../lib/format';
import type { Dataset, Publication } from '../lib/model';
import { CATEGORY_BY_ID } from '../lib/types';
import { GROUPS, groupOf } from './ctx';
import { journalQuartile, type Workspace } from '../workspace';

const fileSafe = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'publicatie';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="insp-sec">
      <div className="caps">{title}</div>
      {children}
    </section>
  );
}

function PerYear({ pubs, label }: { pubs: Publication[]; label: string }) {
  const t = useTokens();
  const years = pubs.map((p) => p.year).filter((y): y is number => y != null);
  const yr = years.length ? range(Math.min(...years), Math.max(...years)) : [];
  const option = useMemo(
    () => columns(t, yr.map((y) => (y === CURRENT_YEAR ? `${y}*` : String(y))), yr.map((y) => pubs.filter((p) => p.year === y).length), 'Outputs', { partialLast: true }),
    [t, pubs], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (yr.length < 2) return null;
  return (
    <Section title="Outputs per jaar">
      <EChart option={option} height={150} label={label} />
    </Section>
  );
}

export function Authors({ ds, p, openPerson }: { ds: Dataset; p: Publication; openPerson: (id: string) => void }) {
  const [all, setAll] = useState(false);
  useEffect(() => {
    setAll(false);
  }, [p]);
  if (!p.authors.length) return <span className="muted">{p.editors.length ? `Red. ${p.editors.join('; ')}` : 'Geen auteurs vermeld'}</span>;
  const cut = 12;
  const shown = all || p.authors.length <= cut + 2 ? p.authors : p.authors.slice(0, cut);
  return (
    <>
      {shown.map((a, i) => (
        <span key={a}>
          <button type="button" className="text-btn" onClick={() => openPerson(a)}>{ds.people.get(a)?.name ?? a}</button>
          {i < shown.length - 1 ? ', ' : ''}
        </span>
      ))}
      {shown.length < p.authors.length && (
        <> … <button type="button" className="btn-link" style={{ padding: 0 }} onClick={() => setAll(true)}>en {p.authors.length - shown.length} anderen</button></>
      )}
    </>
  );
}

/* ───────────── Publication ───────────── */

export function PubInspector({ ds, pub, openPerson, openVenue, setFilters, ws }: {
  ws?: Workspace; ds: Dataset; pub: Publication | undefined; openPerson: (id: string) => void; openVenue: (v: string) => void; setFilters: (p: Partial<Filters>) => void;
}) {
  if (!pub) return <div className="insp-empty">Selecteer een publicatie in de lijst.</div>;
  const cat = CATEGORY_BY_ID[pub.category];
  const where = [pub.volume && `Jg. ${pub.volume}`, pub.issue && `nr. ${pub.issue}`, pub.pages && `p. ${pub.pages}`].filter(Boolean).join(', ');
  const name = fileSafe(pub.title);
  return (
    <>
      <div className="insp-head">
        <div className="insp-kicker">{pub.type} · {pub.year ?? 'jaar onbekend'}</div>
        <h2 className="insp-title">{pub.subtitle ? `${pub.title}: ${pub.subtitle}` : pub.title}</h2>
      </div>
      <dl className="insp-dl">
        <dt>Auteurs</dt>
        <dd><Authors ds={ds} p={pub} openPerson={openPerson} /></dd>
        {pub.journal && (<><dt>Tijdschrift</dt><dd><button type="button" className="text-btn" style={{ fontStyle: 'italic' }} onClick={() => openVenue(`j:${pub.journal!.key}`)}>{pub.journal.name}</button></dd></>)}
        {pub.journal && (() => { const q = journalQuartile(ws ?? null, pub.journal!.key, pub.year); return q ? (<><dt>Ranking</dt><dd><strong>{q.quartile ?? '–'}</strong>{q.rank ? ` · ${q.rank}` : ''}{q.percentile != null ? ` · P${q.percentile}` : ''} <span className="muted">({q.year}{q.categories[0] ? `, ${q.categories[0]}` : ''})</span></dd></>) : null; })()}
        {pub.conference && (<><dt>Conferentie</dt><dd><button type="button" className="text-btn" style={{ fontStyle: 'italic' }} onClick={() => openVenue(`c:${pub.conference!.key}`)}>{pub.venue && pub.category === 'conference' ? pub.venue : pub.conference.name}</button></dd></>)}
        {!pub.journal && !pub.conference && pub.venue && (<><dt>Kanaal</dt><dd style={{ fontStyle: 'italic' }}>{pub.venue}</dd></>)}
        {pub.book && pub.book !== pub.venue && (<><dt>Boek</dt><dd>{pub.book}</dd></>)}
        {pub.series && (<><dt>Reeks</dt><dd>{pub.series.name}</dd></>)}
        {pub.publisher && (<><dt>Uitgever</dt><dd>{[pub.publisher.name, pub.place].filter(Boolean).join(', ')}</dd></>)}
        {where && (<><dt>Plaats</dt><dd className="mono" style={{ fontSize: 11.5 }}>{where}</dd></>)}
        <dt>DOI</dt>
        <dd className="mono" style={{ fontSize: 11.5 }}>
          {pub.doi ? <a href={`https://doi.org/${encodeURI(pub.doi)}`} target="_blank" rel="noopener noreferrer">{pub.doi}</a> : <span className="muted">–</span>}
        </dd>
        {pub.isxn && (<><dt>ISSN/ISBN</dt><dd className="mono" style={{ fontSize: 11.5 }}>{pub.isxn}</dd></>)}
        <dt>Pure-type</dt>
        <dd>{pub.rawType} <span className="muted">· {cat.label}</span></dd>
        {pub.note && (<><dt>Notitie</dt><dd className="ink-2">{pub.note}</dd></>)}
      </dl>
      <Section title="Abstract">
        {pub.abstract ? <p className="abstract">{pub.abstract}</p> : <span className="muted">Geen abstract in de export.</span>}
      </Section>
      {pub.keywords.length > 0 && (
        <Section title="Trefwoorden">
          <div className="kw-list">
            {pub.keywords.map((k) => (
              <button key={k} type="button" className="kw" onClick={() => setFilters({ keyword: k })} title="Filter op dit trefwoord">{ds.keywordLabels.get(k) ?? k}</button>
            ))}
          </div>
        </Section>
      )}
      <div className="insp-actions">
        <button type="button" className="btn btn-sm" onClick={() => download(`${name}.bib`, toBibtex(ds, [pub]), 'application/x-bibtex')}>BibTeX</button>
        <button type="button" className="btn btn-sm" onClick={() => download(`${name}.ris`, toRis([pub]), 'application/x-research-info-systems')}>RIS</button>
        {pub.doi && <a className="btn btn-sm" href={`https://doi.org/${encodeURI(pub.doi)}`} target="_blank" rel="noopener noreferrer">DOI <Icon name="external" size={12} /></a>}
        {pub.scopusUrl && <a className="btn btn-sm" href={pub.scopusUrl} target="_blank" rel="noopener noreferrer">Scopus <Icon name="external" size={12} /></a>}
        {pub.url && <a className="btn btn-sm" href={pub.url} target="_blank" rel="noopener noreferrer">Link <Icon name="external" size={12} /></a>}
      </div>
    </>
  );
}

/* ───────────── Person ───────────── */

export function PersonInspector({ ds, pubs, id, openPerson, openPub, setFilters, filtered }: {
  ds: Dataset; pubs: Publication[]; id: string | null; openPerson: (id: string) => void; openPub: (idx: number) => void;
  setFilters: (p: Partial<Filters>) => void; filtered: boolean;
}) {
  const person = id ? ds.people.get(id) : undefined;
  const mine = useMemo(() => (id ? pubs.filter((p) => p.authors.includes(id)) : []), [pubs, id]);
  if (!person || !id) return <div className="insp-empty">Selecteer een auteur in de lijst.</div>;
  const co = topN(coauthors(mine, id), 60).map(([k, v]) => ({ key: k, label: ds.people.get(k)?.name ?? k, value: v }));
  const coCount = coauthors(mine, id).size;
  const years = mine.map((p) => p.year).filter((y): y is number => y != null);
  const kws = topN(countBy(mine, (p) => p.keywords), 14);
  const venues = topN(countBy(mine, (p) => p.journal?.name ?? p.conference?.name), 8);
  const sorted = [...mine].sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  const first = mine.filter((p) => p.authors[0] === id).length;
  return (
    <>
      <div className="insp-head">
        <div className="insp-kicker">Auteur</div>
        <h2 className="insp-title">{person.name}</h2>
        {person.variants.size > 1 && (
          <div className="insp-note" title={[...person.variants.keys()].join('\n')}>
            Samengevoegd uit {person.variants.size} schrijfwijzen: {[...person.variants.keys()].slice(0, 4).join(' · ')}{person.variants.size > 4 ? ' …' : ''}
          </div>
        )}
      </div>
      <div className="mini-stats">
        <div><div className="v">{fmt(mine.length)}</div><div className="l">outputs</div></div>
        <div><div className="v">{fmt(coCount)}</div><div className="l">co-auteurs</div></div>
        <div><div className="v mono" style={{ fontSize: 14, paddingTop: 3 }}>{years.length ? yearSpan(Math.min(...years), Math.max(...years)) : '–'}</div><div className="l">actief</div></div>
      </div>
      <Section title="Type output">
        <SegBar
          label="Verdeling naar type"
          parts={GROUPS.map((g) => ({ label: g.label, value: mine.filter((p) => groupOf(p.category) === g.id).length, color: g.color }))}
        />
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{fmt(first)}× eerste auteur</div>
      </Section>
      <PerYear pubs={mine} label={`Outputs per jaar van ${person.name}`} />
      <section className="insp-sec" style={{ padding: '14px 0 6px' }}>
        <div className="caps" style={{ padding: '0 18px', marginBottom: 6 }}>Vaste co-auteurs</div>
        <RankRows items={co} onSelect={openPerson} limit={8} empty="Geen co-auteurs." />
      </section>
      {venues.length > 0 && (
        <section className="insp-sec" style={{ padding: '14px 0 6px' }}>
          <div className="caps" style={{ padding: '0 18px', marginBottom: 6 }}>Belangrijkste kanalen</div>
          <RankRows items={venues.map(([k, v]) => ({ key: k, label: k, value: v }))} color="slate" limit={8} />
        </section>
      )}
      {kws.length > 0 && (
        <Section title="Trefwoorden">
          <div className="kw-list">
            {kws.map(([k, n]) => (
              <button key={k} type="button" className="kw" onClick={() => setFilters({ keyword: k })}>{ds.keywordLabels.get(k)}<span className="n">{n}</span></button>
            ))}
          </div>
        </Section>
      )}
      <section className="insp-sec" style={{ padding: '14px 0 0', borderBottom: 0 }}>
        <div className="caps" style={{ padding: '0 18px', marginBottom: 6 }}>Publicaties ({fmt(sorted.length)})</div>
        {sorted.slice(0, 40).map((p) => (
          <button key={p.idx} type="button" className="pub-btn" style={{ paddingLeft: 18, paddingRight: 18 }} onClick={() => openPub(p.idx)}>
            <div className="t">{p.title}</div>
            <div className="m">{[p.year ?? '–', p.type, p.venue].filter(Boolean).join(' · ')}</div>
          </button>
        ))}
      </section>
      <div className="insp-actions">
        <button type="button" className="btn btn-sm btn-dark" onClick={() => setFilters({ person: filtered ? null : id })}>
          <Icon name="filter" size={13} /> {filtered ? 'Persoonsfilter wissen' : 'Filter dashboard op persoon'}
        </button>
      </div>
    </>
  );
}

/* ───────────── Venue ───────────── */

export function VenueInspector({ ds, pubs, venue, openPerson, openPub, setFilters, filtered }: {
  ds: Dataset; pubs: Publication[]; venue: string | null; openPerson: (id: string) => void; openPub: (idx: number) => void;
  setFilters: (p: Partial<Filters>) => void; filtered: boolean;
}) {
  const mine = useMemo(() => (venue ? pubs.filter((p) => venueMatches(p, venue)) : []), [pubs, venue]);
  if (!venue || !mine.length) return <div className="insp-empty">Selecteer een kanaal in de lijst.</div>;
  const kind = { j: 'Tijdschrift', c: 'Conferentie', p: 'Uitgever', s: 'Reeks' }[venue[0] as 'j'] ?? 'Kanaal';
  const years = mine.map((p) => p.year).filter((y): y is number => y != null);
  const authors = topN(countBy(mine, (p) => p.authors), 40).map(([k, v]) => ({ key: k, label: ds.people.get(k)?.name ?? k, value: v }));
  const sorted = [...mine].sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  const isxn = mine.find((p) => p.isxn)?.isxn;
  return (
    <>
      <div className="insp-head">
        <div className="insp-kicker">{kind}</div>
        <h2 className="insp-title">{venueLabel(ds, venue)}</h2>
        {venue[0] === 'j' && isxn && <div className="insp-note mono">ISSN {isxn}</div>}
      </div>
      <div className="mini-stats">
        <div><div className="v">{fmt(mine.length)}</div><div className="l">outputs</div></div>
        <div><div className="v">{fmt(new Set(mine.flatMap((p) => p.authors)).size)}</div><div className="l">auteurs</div></div>
        <div><div className="v mono" style={{ fontSize: 14, paddingTop: 3 }}>{years.length ? yearSpan(Math.min(...years), Math.max(...years)) : '–'}</div><div className="l">periode</div></div>
      </div>
      <PerYear pubs={mine} label={`Outputs per jaar in ${venueLabel(ds, venue)}`} />
      <section className="insp-sec" style={{ padding: '14px 0 6px' }}>
        <div className="caps" style={{ padding: '0 18px', marginBottom: 6 }}>Auteurs</div>
        <RankRows items={authors} onSelect={openPerson} limit={8} />
      </section>
      <section className="insp-sec" style={{ padding: '14px 0 0', borderBottom: 0 }}>
        <div className="caps" style={{ padding: '0 18px', marginBottom: 6 }}>Publicaties ({fmt(sorted.length)})</div>
        {sorted.slice(0, 40).map((p) => (
          <button key={p.idx} type="button" className="pub-btn" style={{ paddingLeft: 18, paddingRight: 18 }} onClick={() => openPub(p.idx)}>
            <div className="t">{p.title}</div>
            <div className="m">{[p.year ?? '–', p.type].join(' · ')}</div>
          </button>
        ))}
      </section>
      <div className="insp-actions">
        <button type="button" className="btn btn-sm btn-dark" onClick={() => setFilters({ venue: filtered ? null : venue })}>
          <Icon name="filter" size={13} /> {filtered ? 'Kanaalfilter wissen' : 'Filter dashboard op kanaal'}
        </button>
      </div>
    </>
  );
}
