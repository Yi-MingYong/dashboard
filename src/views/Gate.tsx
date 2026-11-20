import { useState, type ReactNode } from 'react';
import { LOGOUT_URL } from '../api';
import { APP } from '../config';
import { Icon } from '../components/Icon';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="access">
      <aside className="access-side">
        <div className="access-grid" />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="mark" style={{ width: 32, height: 32 }}><Icon name="logo" size={18} stroke={2.6} square /></div>
          <div className="caps" style={{ color: 'var(--red-ink)' }}>{APP.orgShort}</div>
        </div>
        <div style={{ position: 'relative', maxWidth: 460 }}>
          <h1 className="access-title">{APP.name}</h1>
          <p className="ink-2" style={{ fontSize: 15, lineHeight: 1.6, marginTop: 16 }}>
            Analyse van publicaties, auteurs, thema's, onderwijs en capaciteit. Alleen voor geautoriseerde TU/e-medewerkers.
          </p>
        </div>
        <ul className="access-facts">
          <li>Je logt in met een eenmalige code die naar je mailbox wordt gestuurd (Cloudflare Access).</li>
          <li>Alleen personen op de toegangslijst zien gegevens; de beheerder geeft en trekt toegang per persoon in.</li>
          <li>Gegevens staan in afgeschermde opslag in de EU. Een sessie duurt maximaal een werkdag.</li>
        </ul>
      </aside>
      <main className="access-main">
        <div className="access-card">{children}</div>
      </main>
    </div>
  );
}

function Copy({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <label className="lbl" style={{ marginTop: 10 }}>
      <span className="caps">{label}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input code" readOnly value={value} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
          {copied ? 'Gekopieerd' : 'Kopieer'}
        </button>
      </div>
    </label>
  );
}

export function Loading({ text = 'Laden…' }: { text?: string }) {
  return <div className="state"><div><div className="spinner" />{text}</div></div>;
}

export interface SetupInfo {
  teamDomain: string | null;
  aud: string | null;
  email?: string | null;
  configured?: { teamDomain: boolean; aud: boolean; admins?: boolean };
}

export function Setup({ info }: { info: SetupInfo }) {
  const c = info.configured ?? { teamDomain: false, aud: false, admins: false };
  const accessOn = (c.teamDomain && c.aud) || !!(info.teamDomain && info.aud);
  const vars: [string, string][] = [];
  if (!c.teamDomain && info.teamDomain) vars.push(['ACCESS_TEAM_DOMAIN', info.teamDomain]);
  if (!c.aud && info.aud) vars.push(['ACCESS_AUD', info.aud]);
  if (!c.admins) vars.push(['ADMIN_EMAILS', info.email ?? 'jouw e-mailadres']);
  return (
    <Frame>
      <div className="insp-kicker">Inrichting</div>
      <h2 style={{ fontSize: 20 }}>{accessOn ? 'Nog één stap: vul de Worker-variabelen in' : 'Nog één stap: koppel Cloudflare Access'}</h2>
      {accessOn ? (
        <>
          <p className="ink-2" style={{ margin: '6px 0 4px' }}>
            Zet {vars.length === 1 ? 'deze variabele' : 'deze variabelen'} in het Cloudflare-dashboard
            onder <strong>Workers &amp; Pages → isdashboard → Settings → Variables and Secrets</strong> (type <em>Text</em>) en kies <strong>Deploy</strong>.
            {!c.admins && <> <code>ADMIN_EMAILS</code> is het e-mailadres van de beheerder (meerdere adressen scheiden met een komma).</>}
          </p>
          {vars.map(([k, v]) => <Copy key={k} label={k} value={v} />)}
        </>
      ) : (
        <p className="ink-2" style={{ margin: '6px 0 4px' }}>
          Deze Worker staat nog niet achter Cloudflare Access. Zet het aan via <strong>Workers &amp; Pages → isdashboard → Access → Protect this Worker behind Access</strong> (All traffic)
          en open deze pagina daarna opnieuw; dan staan hier de waarden die je moet invullen.
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
        Tot die tijd geeft de server geen gegevens vrij. Zie de README voor alle stappen.
      </p>
      <button type="button" className="btn btn-red" style={{ marginTop: 6 }} onClick={() => window.location.reload()}>Opnieuw controleren</button>
    </Frame>
  );
}

export function NoAccess({ email, admins, onRetry }: { email: string; admins: string[]; onRetry: () => void }) {
  return (
    <Frame>
      <div className="insp-kicker">Geen toegang</div>
      <h2 style={{ fontSize: 20 }}>Je hebt nog geen toegang</h2>
      <p className="ink-2" style={{ margin: '6px 0 14px' }}>
        Je bent ingelogd als <strong>{email}</strong>, maar staat nog niet op de toegangslijst. De beheerder ziet je aanvraag in Beheer en kan je met één klik toegang geven.
        {admins.length > 0 && <> Vragen? Mail <a href={`mailto:${admins[0]}?subject=${encodeURIComponent(`Toegang ${APP.short}`)}`}>{admins[0]}</a>.</>}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-red" onClick={onRetry}>Opnieuw controleren</button>
        <a className="btn" href={LOGOUT_URL}>Uitloggen</a>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
        Verkeerd adres gebruikt? Log uit en log opnieuw in met het adres waarop je toegang hebt gekregen.
      </div>
    </Frame>
  );
}

export function SessionExpired() {
  return (
    <Frame>
      <div className="insp-kicker">Sessie verlopen</div>
      <h2 style={{ fontSize: 20 }}>Log opnieuw in</h2>
      <p className="ink-2" style={{ margin: '6px 0 14px' }}>Je sessie is verlopen (maximaal een werkdag). Na opnieuw laden krijg je een nieuwe code in je mailbox.</p>
      <button type="button" className="btn btn-red big" onClick={() => window.location.reload()}>Opnieuw inloggen</button>
    </Frame>
  );
}

export function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Frame>
      <div className="insp-kicker">Fout</div>
      <h2 style={{ fontSize: 20 }}>Het dashboard kon niet laden</h2>
      <div className="notice" style={{ margin: '10px 0 14px' }}>{message}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-red" onClick={onRetry}>Opnieuw proberen</button>
        <a className="btn" href={LOGOUT_URL}>Uitloggen</a>
      </div>
    </Frame>
  );
}
