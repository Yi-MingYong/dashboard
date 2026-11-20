import { useCallback, useEffect, useState } from 'react';
import { api, publishDataset } from '../api';
import { Icon } from '../components/Icon';
import { ingestFile, toUpload, type Candidate } from '../ingest/detect';
import { fmt } from '../lib/format';
import { EMAIL_RE, emailAllowed, KIND_LABEL, KIND_SCOPE, ROLE_LABEL, ROLES, type AccessRequest, type AuditEvent, type DatasetInfo, type Me, type Role, type UserRow } from '../shared/model';

const dateNl = (s: string | null) => (s ? new Date(s).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const sizeKb = (b64: number) => `${fmt(Math.max(1, Math.round((b64 * 0.75) / 1024)))} kB`;

const ACTION_LABEL: Record<string, string> = {
  view: 'Dashboard geopend',
  denied: 'Geweigerd: geen toegang',
  'dataset.add': 'Gegevens gepubliceerd',
  'dataset.delete': 'Gegevens verwijderd',
  'user.add': 'Toegang gegeven',
  'user.update': 'Toegang gewijzigd',
  'user.remove': 'Toegang ingetrokken',
};

const LOG_FILTERS = {
  changes: { label: 'Wijzigingen', test: (a: string) => a !== 'view' && a !== 'denied' },
  denied: { label: 'Geweigerd', test: (a: string) => a === 'denied' },
  view: { label: 'Geopend', test: (a: string) => a === 'view' },
  all: { label: 'Alles', test: () => true },
};

/** "r.m.dijkman@tue.nl" → "R. M. Dijkman" */
function nameFromEmail(email: string): string {
  return email.split('@')[0].split(/[._-]+/).filter(Boolean).map((p) => (p.length === 1 ? `${p.toUpperCase()}.` : p[0].toUpperCase() + p.slice(1))).join(' ');
}

interface Pending {
  file: File;
  c?: Candidate;
  err?: string;
  teachers: boolean;
}

export function Admin({ me, datasets, onChanged, onAuthLost, incoming, onIncomingTaken }: {
  me: Me; datasets: DatasetInfo[]; onChanged: () => Promise<void>; onAuthLost: (e: unknown) => void; incoming: File[]; onIncomingTaken: () => void;
}) {
  const [cands, setCands] = useState<Pending[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [logFilter, setLogFilter] = useState<keyof typeof LOG_FILTERS>('changes');
  const [logAll, setLogAll] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role: Role }>({ email: '', name: '', role: 'viewer' });

  const fail = useCallback((e: unknown) => {
    onAuthLost(e);
    setErr((e as Error).message);
  }, [onAuthLost]);

  const refresh = useCallback(async () => {
    const [u, ev] = await Promise.all([api.users(), api.audit()]);
    setUsers(u.users);
    setRequests(u.requests);
    setEvents(ev);
  }, []);

  useEffect(() => {
    refresh().catch(fail);
  }, [refresh, fail]);

  const run = async (label: string, fn: () => Promise<void>): Promise<boolean> => {
    setErr(null);
    setBusy(label);
    try {
      await fn();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const out = await Promise.all([...files].map(async (file): Promise<Pending> => {
      try {
        return { file, teachers: false, c: await ingestFile(file, { includeTeachers: false }) };
      } catch (e) {
        return { file, teachers: false, err: (e as Error).message };
      }
    }));
    setCands((c) => [...c, ...out]);
  }, []);

  useEffect(() => {
    if (!incoming.length) return;
    addFiles(incoming);
    onIncomingTaken();
  }, [incoming, addFiles, onIncomingTaken]);

  const reparse = async (i: number, teachers: boolean) => {
    const c = await ingestFile(cands[i].file, { includeTeachers: teachers });
    setCands((cs) => cs.map((y, j) => (j === i ? { ...y, c, teachers } : y)));
  };

  const ready = cands.filter((x) => x.c);
  const publish = () =>
    run('Publiceren…', async () => {
      for (const [i, x] of ready.entries()) {
        const { meta, payload } = toUpload(x.c!);
        await publishDataset(meta, payload, (d, n) => setBusy(`Publiceren ${i + 1}/${ready.length}${n > 1 ? ` · deel ${d + 1}/${n}` : ''}…`));
        setCands((cs) => cs.filter((y) => y !== x));
      }
      await Promise.all([onChanged(), refresh()]);
    });

  const trusted = me.allowedDomains.map((d) => `@${d}`).join(' of ') || 'een vertrouwd domein';
  const isExternal = (email: string) => !emailAllowed(email, me.allowedDomains) && !me.admins.includes(email);

  const grant = async (email: string, name: string, role: Role): Promise<boolean> => {
    const external = isExternal(email);
    const isNew = !users?.some((u) => u.email === email);
    if (external && (isNew || role === 'admin')) {
      const ok = confirm(
        `Extra bevestiging: extern e-mailadres\n\n${email} is geen adres op ${trusted}.\n\n` +
        `Controleer dat dit adres echt van ${name} is. Na inloggen ziet deze persoon alles wat bij de rol "${ROLE_LABEL[role]}" hoort.\n\n` +
        `Toegang geven?`,
      );
      if (!ok) return false;
    }
    return run('Opslaan…', async () => {
      await api.putUser(email, name, role, external);
      await refresh();
      if (email === me.email) await onChanged();
    });
  };

  const formEmail = form.email.trim().toLowerCase();
  const formExternal = EMAIL_RE.test(formEmail) && isExternal(formEmail);
  const formValid = EMAIL_RE.test(formEmail) && form.name.trim().length > 1;
  const existing = users?.find((u) => u.email === formEmail);
  const shownEvents = (events ?? []).filter((e) => LOG_FILTERS[logFilter].test(e.action));

  return (
    <div className="view pad stack">
      {err && <div className="notice">{err}</div>}

      <section className="panel">
        <header className="panel-head"><span className="panel-title">Gegevens</span><span className="panel-sub">{datasets.length} datasets gepubliceerd · direct zichtbaar voor iedereen met de juiste rol</span></header>
        <div className="panel-body">
          <table className="tbl cards">
            <thead><tr><th>Dataset</th><th>Type</th><th>Toegang</th><th>Jaren</th><th className="r">Regels</th><th className="r">Grootte</th><th>Gepubliceerd</th><th /></tr></thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id}>
                  <td className="card-title"><div style={{ fontWeight: 500 }}>{d.label}</div><div className="s mono">{d.source}</div></td>
                  <td className="nowrap" data-label="Type">{KIND_LABEL[d.kind]}</td>
                  <td className="nowrap" data-label="Toegang">{KIND_SCOPE[d.kind] === 'education' ? 'Onderwijs' : 'Onderzoek'}</td>
                  <td className="mono nowrap" data-label="Jaren">{d.years}</td>
                  <td className="r" data-label="Regels">{fmt(d.rows)}</td>
                  <td className="r nowrap muted" data-label="Grootte">{sizeKb(d.bytes)}</td>
                  <td className="nowrap muted" data-label="Gepubliceerd"><div>{dateNl(d.addedAt)}<div className="s">{d.addedBy}</div></div></td>
                  <td className="r card-actions">
                    <button
                      type="button"
                      className="btn btn-xs"
                      disabled={!!busy}
                      onClick={() => confirm(`"${d.label}" verwijderen? Het verdwijnt direct uit het dashboard.`) && run('Verwijderen…', async () => {
                        await api.removeDataset(d.id);
                        await Promise.all([onChanged(), refresh()]);
                      })}
                    >
                      Verwijder
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!datasets.length && <div className="empty">Nog geen gegevens. Voeg hieronder bestanden toe.</div>}
          <div style={{ padding: 14 }}>
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
            >
              Sleep bestanden hierheen of{' '}
              <label className="btn-link" style={{ padding: 0, cursor: 'pointer' }}>kies bestanden<input type="file" multiple hidden accept=".ris,.txt,.xlsx" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} /></label>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                Pure-export (.ris), ECTS-matrix, capaciteitsmodel, tijdschriftranking, ledenlijst (.xlsx). Het bestand wordt in je browser gelezen; alleen de benodigde velden worden gepubliceerd, het bronbestand zelf niet.
              </div>
            </div>
            {cands.map((x, i) => (
              <div key={i} className="notice info" style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ flex: 1 }}>{x.file.name}</strong>
                  <button type="button" className="btn btn-xs" disabled={!!busy} onClick={() => setCands((c) => c.filter((_, j) => j !== i))}>Weg</button>
                </div>
                {x.err ? <div className="down">{x.err}</div> : x.c && (
                  <>
                    <div>Herkend als <strong>{KIND_LABEL[x.c.kind]}</strong> · <span className="mono">{x.c.years}</span> · {fmt(x.c.rows)} regels · zichtbaar voor {KIND_SCOPE[x.c.kind] === 'education' ? 'rol onderwijs en beheerders' : 'alle lezers'}</div>
                    <label className="lbl" style={{ marginTop: 6 }}>
                      <span className="caps">Naam in dashboard</span>
                      <input className="input" value={x.c.label} onChange={(e) => setCands((cs) => cs.map((y, j) => (j === i ? { ...y, c: { ...y.c!, label: e.target.value } } : y)))} />
                    </label>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{[...x.c.notes, ...x.c.warnings].map((n) => <li key={n}>{n}</li>)}</ul>
                    {x.c.kind === 'ects' && (
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {(x.c.payload as { checks: { ok: boolean; label: string; detail: string }[] }).checks.map((ck) => <li key={ck.label} className={ck.ok ? 'up' : 'down'}>{ck.ok ? '✓' : '✗'} {ck.label}: {ck.detail}</li>)}
                      </ul>
                    )}
                    {x.c.personalData && (
                      <label style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <input type="checkbox" checked={x.teachers} onChange={(e) => reparse(i, e.target.checked)} />
                        <span>Docentnamen opnemen (persoonsgegevens; alleen als dat nodig en afgestemd is)</span>
                      </label>
                    )}
                  </>
                )}
              </div>
            ))}
            {ready.length > 0 && (
              <button type="button" className="btn btn-red" style={{ marginTop: 10 }} disabled={!!busy} onClick={publish}>
                <Icon name="upload" size={13} /> {busy ?? `Publiceer ${ready.length === 1 ? '1 bestand' : `${ready.length} bestanden`}`}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <span className="panel-title">Toegang</span>
          <span className="panel-sub">{users ? `${users.length} van max. ${me.seats} personen` : 'Laden…'} · andere adressen dan {trusted} met extra bevestiging</span>
        </header>
        <div className="panel-body">
          {requests.length > 0 && (
            <div style={{ padding: '12px 14px 0' }}>
              <div className="caps" style={{ marginBottom: 6 }}>Aanvragen · ingelogd zonder toegang (30 dagen)</div>
              {requests.map((r) => (
                <div key={r.email} className="notice info" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ flex: 1, minWidth: 200 }}><strong>{r.email}</strong> <span className="muted">· {dateNl(r.at)}</span></span>
                  {isExternal(r.email) && <span className="warn">extern adres</span>}
                  <button type="button" className="btn btn-red btn-xs" disabled={!!busy} onClick={() => grant(r.email, nameFromEmail(r.email), 'viewer')}>Toegang geven</button>
                  <button type="button" className="btn btn-xs" disabled={!!busy} onClick={() => setForm({ email: r.email, name: nameFromEmail(r.email), role: 'viewer' })}>Aanpassen…</button>
                </div>
              ))}
            </div>
          )}
          <table className="tbl cards">
            <thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th>Sinds</th><th>Toegevoegd door</th><th /></tr></thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.email}>
                  <td className="card-title" style={{ fontWeight: 500 }}>{u.name}{u.email === me.email && <span className="kind" style={{ marginLeft: 6, padding: '1px 4px' }}>JIJ</span>}{isExternal(u.email) && <span className="kind warn" style={{ marginLeft: 6, padding: '1px 4px' }} title={`Geen adres op ${trusted}`}>EXTERN</span>}</td>
                  <td className="ink-2" data-label="E-mail" style={{ overflowWrap: 'anywhere' }}>{u.email}</td>
                  <td data-label="Rol">
                    {u.bootstrap ? (
                      <span className="nowrap" title="Vastgelegd in de Worker-variabele ADMIN_EMAILS (Cloudflare)"><Icon name="lock" size={12} /> {ROLE_LABEL.admin} · vast</span>
                    ) : (
                      <select className="select select-sm" value={u.role} disabled={!!busy || u.email === me.email} onChange={(e) => grant(u.email, u.name, e.target.value as Role)}>
                        {ROLES.map((ro) => <option key={ro} value={ro}>{ROLE_LABEL[ro]}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="muted nowrap" data-label="Sinds">{dateNl(u.addedAt)}</td>
                  <td className="muted" data-label="Toegevoegd door">{u.addedBy ?? '–'}</td>
                  <td className="r card-actions">
                    <button
                      type="button"
                      className="btn btn-xs"
                      disabled={!!busy || u.bootstrap || u.email === me.email}
                      onClick={() => confirm(`Toegang van ${u.name} intrekken? Dit werkt direct: het dashboard geeft deze persoon geen gegevens meer.`) && run('Intrekken…', async () => {
                        await api.removeUser(u.email);
                        await refresh();
                      })}
                    >
                      Intrekken
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            style={{ padding: 14, display: 'grid', gap: 8, maxWidth: 760 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!formValid) return;
              grant(formEmail, form.name.trim(), form.role).then((ok) => ok && setForm({ email: '', name: '', role: 'viewer' }));
            }}
          >
            <span className="caps">Persoon toevoegen of wijzigen</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" style={{ flex: '2 1 220px' }} type="email" placeholder="naam@tue.nl" aria-label="E-mailadres" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="input" style={{ flex: '2 1 180px' }} placeholder="Naam" aria-label="Naam" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="select" aria-label="Rol" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((ro) => <option key={ro} value={ro}>{ROLE_LABEL[ro]}</option>)}
              </select>
              <button type="submit" className="btn btn-red" disabled={!!busy || !formValid}>{existing ? 'Wijzigen' : 'Toegang geven'}</button>
            </div>
            {formExternal && <span className="warn" style={{ fontSize: 12 }}>Extern adres: geen {trusted}. Bij {existing ? 'beheerdersrechten' : 'toegang geven'} vraagt het dashboard om een extra bevestiging.</span>}
            <span className="muted" style={{ fontSize: 12 }}>
              De persoon logt daarna in op dit adres met een eenmalige code per e-mail. Toegang geven en intrekken werkt direct. Loop deze lijst elk kwartaal na.
            </span>
          </form>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <span className="panel-title">Logboek</span>
          <span className="panel-sub">wie wanneer inlogde en wat er veranderde · 365 dagen bewaard</span>
          <span className="spacer" />
          <select className="select select-sm" aria-label="Filter logboek" value={logFilter} onChange={(e) => setLogFilter(e.target.value as keyof typeof LOG_FILTERS)}>
            {Object.entries(LOG_FILTERS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
          <button type="button" className="btn btn-xs" style={{ marginLeft: 6 }} disabled={!!busy} onClick={() => refresh().catch(fail)}><Icon name="reset" size={12} /> Ververs</button>
        </header>
        <div className="panel-body">
          <table className="tbl cards">
            <thead><tr><th>Tijd</th><th>Wie</th><th>Gebeurtenis</th><th>Details</th></tr></thead>
            <tbody>
              {shownEvents.slice(0, logAll ? undefined : 50).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap muted card-title" style={{ fontSize: 12.5 }}>{dateNl(e.at)}</td>
                  <td data-label="Wie" style={{ overflowWrap: 'anywhere' }}>{e.email}</td>
                  <td className={e.action === 'denied' ? 'down nowrap' : 'nowrap'} data-label="Gebeurtenis">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="ink-2" data-label="Details" style={{ overflowWrap: 'anywhere' }}>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events && !shownEvents.length && <div className="empty">Geen gebeurtenissen.</div>}
          {shownEvents.length > 50 && !logAll && (
            <div style={{ padding: 10 }}><button type="button" className="btn btn-xs" onClick={() => setLogAll(true)}>Toon alle {fmt(shownEvents.length)}</button></div>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><span className="panel-title">Beveiliging</span></header>
        <div className="panel-body padded prose">
          <ul style={{ margin: 0 }}>
            <li><strong>Inloggen</strong> gaat via Cloudflare Access met een eenmalige code per e-mail; een sessie duurt maximaal 8 uur. Toegang geven kan aan elk e-mailadres; voor adressen buiten {trusted} vraagt het dashboard een extra bevestiging en worden ze gemarkeerd als EXTERN.</li>
            <li><strong>Elk verzoek</strong> wordt op de server gecontroleerd: de handtekening van het Access-token, of de persoon op de toegangslijst staat en welke rol hij of zij heeft. Lezers zien alleen onderzoeksgegevens; onderwijs en capaciteit vereisen de rol onderwijs.</li>
            <li><strong>Intrekken</strong> werkt direct voor alles wat daarna wordt opgevraagd. Wat iemand eerder al zag of exporteerde, valt niet terug te halen.</li>
            <li><strong>Opslag</strong> in Cloudflare D1 binnen de EU-jurisdictie. Gegevens staan nooit in GitHub of in de publieke bestanden; de build weigert .xlsx/.csv/.ris-bestanden in de repository. Herstel van een vergissing kan tot 7 dagen terug (D1 Time Travel).</li>
            <li><strong>Zelf doen:</strong> tweestapsverificatie aan op Cloudflare en GitHub, elk kwartaal de toegangslijst nalopen, en alleen de kolommen publiceren die nodig zijn (docentnamen staan standaard uit).</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
