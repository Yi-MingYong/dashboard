# Research Output Dashboard

Dashboard voor de IS-groep met onderzoeksoutput (Pure), onderwijs (ECTS-matrix) en capaciteit
(scenariomodel). **Alleen voor geautoriseerde personen.** Je logt in met een eenmalige code die
naar je mailbox wordt gestuurd (Cloudflare Access). De gegevens staan in een afgeschermde database
in de EU (Cloudflare D1), nooit in GitHub of in de publieke bestanden.

Live: https://isdashboard.research-output.workers.dev. Het oude adres https://isdashboard.vercel.app stuurt daarheen door.

## Onderdelen

| # | Onderdeel | Inhoud | Rol |
|---|---|---|---|
| 1 | Overzicht | KPI's met vergelijking met de vorige periode, output per jaar, top auteurs en kanalen | lezer |
| 2 | Publicaties | Lijst met inspectiepaneel, inclusief tijdschriftranking (kwartiel) en export | lezer |
| 3 | Auteurs | IS-leden of iedereen, profiel met co-auteurs en kanalen | lezer |
| 4 | Thema's | Trefwoorden door de tijd, opkomend en afnemend | lezer |
| 5 | Kanalen | Tijdschriften, conferenties, uitgevers en reeksen | lezer |
| 6 | Samenwerking | Co-auteursnetwerk en teamgrootte | lezer |
| 7 | Onderwijs | IE&IS-ECTS per groep en jaar, vakken, projecten, nieuwe vakken, instroom, BEP-prognose | onderwijs |
| 8 | Capaciteit | Benodigde versus beschikbare uren per academisch jaar, bezetting, vakken, cohorten | onderwijs |
| 9 | Data & kwaliteit | Naamvarianten, volledigheid en bronnen | lezer |
| – | Beheer | Gegevens publiceren en verwijderen, toegang geven en intrekken, logboek | beheerder |

Sneltoetsen: `1`–`9` voor de onderdelen, `/` om te zoeken, `↑`/`↓` door lijsten.

## Zo werkt inloggen

1. **Cloudflare Access** staat vóór de hele site en stuurt een eenmalige code naar je e-mailadres. Welke adressen
   een code kunnen krijgen, bepaalt het Access-beleid (zie *Eenmalige inrichting*, stap 5). Na maximaal 8 uur moet
   je opnieuw inloggen.
2. **De server controleert elk verzoek**: de handtekening van het Access-token, en of je op de
   **toegangslijst** in Beheer staat. Sta je er niet op, dan zie je *Je hebt nog geen toegang*. De beheerder
   ziet je aanvraag dan in Beheer en kan je met één klik toegang geven.
3. **Je rol bepaalt wat je ziet**:

| Rol | Ziet |
|---|---|
| Lezer · onderzoek | Pure-export, ledenlijst en tijdschriftranking |
| Lezer · onderzoek + onderwijs | daarnaast ECTS-matrix en capaciteitsmodel |
| Beheerder | alles, plus Beheer (gegevens, toegang en logboek) |

De vaste beheerder staat in de Worker-variabele `ADMIN_EMAILS` (in Cloudflare, niet in de repository) en kan
in de app niet worden verwijderd. Zolang die variabele leeg is, geeft de server geen gegevens vrij.

## Beveiliging

- **Persoonlijke accounts op een vaste lijst.** Er zijn geen gedeelde wachtwoorden of codes. Kunnen inloggen is
  niet genoeg: je moet ook op de toegangslijst staan. Toegang geven en intrekken werkt direct.
- **Externe adressen met extra bevestiging.** Toegang geven kan aan elk e-mailadres. Voor adressen buiten
  `ALLOWED_DOMAINS` (exact domein; subdomeinen zoals `student.tue.nl` tellen als extern) vraagt het dashboard een
  extra bevestiging, en de server weigert het zonder die bevestiging. Externe personen krijgen het label *EXTERN*
  en staan zo in het logboek.
- **Sessies van maximaal een werkdag** (8 uur), ingesteld in Cloudflare Access.
- **Rollen per dataset.** De server geeft onderwijs- en capaciteitsgegevens alleen aan de rollen die ze mogen zien.
- **Alleen de kolommen die nodig zijn.** Bestanden worden in de browser van de beheerder gelezen. Alleen de
  benodigde velden worden gepubliceerd, het bronbestand zelf niet. Docentnamen uit de ECTS-matrix staan standaard uit.
- **Opslag in de EU.** Cloudflare D1 binnen de EU-jurisdictie. Herstel van een vergissing kan tot 7 dagen terug.
- **Nooit data in git of `public/`.** De build weigert `.xlsx`, `.csv`, `.ris` en vergelijkbare bestanden in `data/` of `public/`.
- **Strikte headers.** Content-Security-Policy met alleen eigen scripts, HSTS, `noindex` en geen framing.
  Er zijn geen externe scripts of analytics, en de fonts worden zelf gehost.
- **Schrijfacties** worden alleen geaccepteerd vanaf de eigen site (Origin-controle en JSON), zodat een andere
  site niets namens je kan wijzigen.
- **Logboek.** Wie wanneer het dashboard opende, geweigerde pogingen, en elke wijziging in gegevens of toegang.
  Regels worden 365 dagen bewaard.
- **Faalt dicht.** Zolang Access niet volledig is gekoppeld, geeft de server geen gegevens vrij.
- **Tweestapsverificatie.** Zet die aan op Cloudflare en GitHub, en geef niemand anders schrijfrechten op de
  repository. Wie de code kan wijzigen, kan ook de toegangscontrole wijzigen.

## Handleiding voor de beheerder

**Iemand toegang geven**
- Heeft de persoon het al geprobeerd? Dan staat hij of zij onder **Beheer → Toegang → Aanvragen zonder
  toegang**. Klik **Toegang geven** (rol *Lezer · onderzoek*) of **Aanpassen…** om eerst naam en rol te kiezen.
- Anders vul je onderaan het e-mailadres, de naam en de rol in en klik je **Toegang geven**.
- Is het adres extern (niet op een domein uit `ALLOWED_DOMAINS`), dan krijg je eerst een extra bevestiging.
  Controleer dan goed dat het adres van de juiste persoon is.
- De persoon gaat naar het dashboard, vult het e-mailadres in en typt de code uit de mail over.

**Rol wijzigen of intrekken:** kies een andere rol in de tabel, of klik **Intrekken**. Dit werkt direct.

**Gegevens publiceren**
1. Ga naar **Beheer → Gegevens** en sleep de bestanden erin. Elk bestand wordt in je browser herkend en
   gecontroleerd. Ondersteund:
   - Pure-export (`.ris`)
   - ECTS-matrix (`.xlsx`)
   - capaciteitsmodel (`.xlsx`)
   - tijdschriftranking (`.xlsx`)
   - ledenlijst ("IS Authors", `.xlsx`)
2. Klik **Publiceer**. De gegevens zijn direct zichtbaar voor iedereen met de juiste rol.
3. Een verouderde dataset haal je weg met **Verwijder**.

Bronbestanden (Excel) bewaar je in TU/e OneDrive of Teams, niet in GitHub.

**Logboek:** in **Beheer → Logboek** filter je op *Wijzigingen*, *Geweigerd*, *Geopend* of *Alles*.

**Elk kwartaal nalopen**
1. Ga de lijst in **Beheer → Toegang** langs en trek toegang in van mensen die weg zijn of het niet meer nodig hebben.
2. Bekijk in het logboek de geweigerde pogingen.
3. Verwijder in Cloudflare onder **Zero Trust → Team & Resources → Users** de mensen die geen plek meer nodig hebben (zie *Plekken* hieronder).
4. Controleer dat tweestapsverificatie op Cloudflare en GitHub nog aanstaat.

**Vergissing herstellen:** D1 kan de database tot 7 dagen terugzetten:

```bash
npx wrangler d1 time-travel restore isdashboard --timestamp=2026-11-04T09:00:00+01:00
```

## Plekken (maximaal 50 personen)

Cloudflare Zero Trust is gratis voor maximaal 50 gebruikers. **Iedereen die via Access inlogt, telt mee**,
ook iemand die niet op de toegangslijst staat en dus wordt geweigerd. Verwijder zulke personen
onder **Zero Trust → Team & Resources → Users**. Zet daar ook *seat expiration* aan, zodat plekken na een
maand zonder gebruik automatisch vrijkomen. Het paneel Toegang toont hoeveel personen op de lijst staan.

## Eenmalige inrichting in Cloudflare

Al gedaan: de D1-database `isdashboard` in de EU-jurisdictie (id `3a23db17-f03e-422d-a35e-41dded5f1ce4`)
en het workers.dev-subdomein `research-output`.

1. **Zero Trust aanzetten.** Kies in het Cloudflare-dashboard **Zero Trust**, kies een neutrale teamnaam (bijvoorbeeld
   `is-dashboard`; die is zichtbaar op het inlogscherm) en het **Free**-plan. Betaalgegevens zijn verplicht, maar er
   wordt niets afgeschreven.
2. **Inloggen met een code per e-mail.** Ga naar **Zero Trust → Integrations → Identity providers → Add new
   identity provider → One-time PIN**.
3. **Werkdagsessie.** Zet onder **Zero Trust → Access controls → Access settings** de *global session duration* op **8 hours**.
4. **Repository koppelen.** Ga naar **Workers & Pages → Create application → Import a repository** en kies
   deze repository. Gebruik deze instellingen:
   - Workernaam: `isdashboard` (moet gelijk zijn aan `wrangler.jsonc`)
   - Branch: `main`
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`

   Elke push naar `main` wordt daarna automatisch uitgerold. De site laat nog niets zien, omdat de server
   zonder Access niets vrijgeeft.
5. **Access aanzetten.** Ga naar **Workers & Pages → isdashboard → Access → Protect this Worker behind Access**
   en kies **All traffic**. Kies onder *Authentication policy* wie een inlogcode mag krijgen:
   - **Iedereen** (selector *Everyone*, in te stellen via **Zero Trust → Access controls → Policies**): nodig als je
     ook externe adressen toegang wilt geven. De toegangslijst in Beheer is dan het enige slot op de gegevens;
     iedereen met de link kan een code aanvragen en neemt daarmee een plek in, maar ziet niets.
   - Of strenger: alleen **Email domain** `tue.nl` (plus eventuele losse externe adressen als *Emails*-regel).
   Zet de *session duration* op **8 hours** en klik **Apply Access**. Dit beschermt ook de preview-adressen.
6. **Variabelen invullen.** Open https://isdashboard.research-output.workers.dev en log in. Het
   scherm *Nog één stap* toont `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` en `ADMIN_EMAILS` (je eigen e-mailadres;
   meerdere beheerders scheid je met een komma). Voeg ze toe onder **Workers & Pages → isdashboard → Settings →
   Variables and Secrets** als type *Text*, samen met `ALLOWED_DOMAINS` (vertrouwde domeinen, bijvoorbeeld `tue.nl`;
   meerdere scheid je met een komma; het domein moet exact overeenkomen, subdomeinen tellen niet mee) en klik
   **Deploy**. Aan adressen op deze domeinen geef je zonder extra bevestiging toegang.
   De AUD staat ook in Zero Trust onder **Access controls → Applications → isdashboard** (*Application Audience (AUD) Tag*).
7. **Klaar.** Herlaad de pagina: je bent beheerder. Geef collega's toegang via Beheer en publiceer de gegevens opnieuw.
8. **Tweestapsverificatie** aan op Cloudflare en GitHub.

Het Vercel-project is alleen nog een doorverwijzing (`vercel.json`) en mag weg zodra iedereen het nieuwe adres gebruikt.

## Lokaal ontwikkelen

```bash
npm install
cp .dev.vars.example .dev.vars   # lokaal ben je ingelogd als dit adres (werkt alleen op localhost)
npm run dev:api                  # bouwt de app en start de Worker met een lokale database op http://localhost:8787
npm run dev                      # tweede terminal: Vite op http://localhost:5173, /api gaat naar de Worker
npm test                         # parser-, naam-, token-, codec- en API-regeltests
npm run build                    # controleert data/ en public/, typecheck en bouwt dist/
```

`npm run preview` bouwt en start alles in één keer op http://localhost:8787. Een ander adres testen kan met
`npx wrangler dev --var DEV_ACCESS_EMAIL:iemand@tue.nl`.

Instellingen:
- groepsnaam en naamgeving: `src/config.ts`
- vaste beheerders (`ADMIN_EMAILS`), vertrouwde domeinen (`ALLOWED_DOMAINS`), `ACCESS_TEAM_DOMAIN` en `ACCESS_AUD`:
  Worker-variabelen in Cloudflare (lokaal in `.dev.vars`)
- naamuitzonderingen: `data/aliases.json`

## API

Alle routes vereisen een geldig Access-token en een plek op de toegangslijst. Routes onder `/api/admin` zijn alleen voor beheerders.

| Route | Doel |
|---|---|
| `GET /api/me` | Wie ben ik, welke rol en welke beheerders |
| `GET /api/datasets` | Datasets die jouw rol mag zien |
| `GET /api/datasets/:id/parts/:n` | Deel *n* van een dataset |
| `POST /api/admin/datasets` | Nieuwe dataset aanmaken (metadata) |
| `PUT /api/admin/datasets/:id/parts/:n` | Deel *n* uploaden; na het laatste deel is de dataset zichtbaar |
| `DELETE /api/admin/datasets/:id` | Dataset verwijderen |
| `GET /api/admin/users` | Toegangslijst en aanvragen |
| `PUT` / `DELETE /api/admin/users/:email` | Toegang geven, wijzigen of intrekken |
| `GET /api/admin/audit` | Logboek |

Datasets worden in delen van maximaal 1 MB verstuurd, zodat elk verzoek binnen de CPU-limiet van het gratis
Workers-plan blijft. De browser comprimeert de gegevens vóór het versturen; de server slaat ze ongewijzigd op.

## Bestanden van andere jaren

Kolommen worden herkend aan hun naam, niet aan hun positie:
- ECTS: `Enroll 26`, `Def aantal 26`, `ECTS 26`, `IEIS 26`, `Remark 2026`
- Capaciteit: academische jaren zoals `2030/2031`
- Ranking: kolommen Journal, Year, Quartile, …

Nieuwe of oudere jaren worden dus automatisch meegenomen. Heb je meerdere ECTS-bestanden gepubliceerd, dan wint
het nieuwste per jaar en vullen oudere bestanden alleen jaren aan die in het nieuwste ontbreken. Zit er een
tabblad *Totals* in, dan worden de berekende IE&IS-totalen daartegen gecontroleerd. De uitkomst zie je in Beheer
en bij Onderwijs.
