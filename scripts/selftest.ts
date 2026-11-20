/** Lightweight checks for the parsers, normalisation rules, Access token verification and API rules (npm test). */
import assert from 'node:assert/strict';
import { buildDataset } from '../src/lib/model';
import { buildPeople, parseName } from '../src/lib/names';
import { parseRis, serializeRis } from '../src/lib/ris';
import { classifyType } from '../src/lib/types';
import { conferenceRef, publisherRef, seriesRef } from '../src/lib/venues';
import { zipSync, strToU8 } from 'fflate';
import { ingestBytes } from '../src/ingest/detect';
import { readXlsx } from '../src/ingest/xlsx';
import { decodePayload, encodePayload, fromBase64, splitChunks, toBase64 } from '../src/shared/codec';
import { emailAllowed, LIMITS } from '../src/shared/model';
import { AccessError, normalizeTeamDomain, peekToken, resetKeyCache, verifyAccessToken, type Fetcher } from '../worker/access';
import { checkExternal, chunkCount, HttpError, parseEmail, parseNewDataset, partLength, validPart } from '../worker/rules';

let n = 0;
const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

test('RIS: multi-line values and record boundaries', () => {
  const recs = parseRis('TY  - JOUR\nT1  - A\nN1  - Publisher Copyright:\n© 2026\nAU  - X, Y.\nER  - \n\nTY  - GEN\nT1  - B\nER  - \n');
  assert.equal(recs.length, 2);
  assert.equal(recs[0].N1[0], 'Publisher Copyright:\n© 2026');
  assert.equal(parseRis(serializeRis(recs)).length, 2);
});

test('Names: particles in every position', () => {
  for (const raw of ['Aalst, van der, W.M.P.', 'van der Aalst, Wil M.P.', 'Van Der Aalst, W. M.P.']) {
    assert.equal(parseName(raw).surnameKey, 'vanderaalst', raw);
  }
  const p = parseName('Beest, Nick van');
  assert.equal(p.surnameKey, 'vanbeest');
  assert.equal(p.firstName, 'nick');
  assert.equal(parseName('Verbeek, H.M.W. (Eric)').firstName, 'eric');
});

test('Names: merge variants, keep ambiguous initials apart', () => {
  const occ = new Map([
    ['Dijkman, R.M.', 87], ['Dijkman, Remco M.', 41], ['Dijkman, Remco', 35],
    ['Zhang, Yingqian', 100], ['Zhang, Yu', 3], ['Zhang, Y.', 5],
    ['Türetken, Oktay', 10], ['Turetken, O.', 4],
    ['Boer, Arjen-Kars', 9], ['Boer, Arjen Kars', 6],
  ]);
  const { byRaw, people } = buildPeople(occ);
  assert.equal(byRaw.get('Dijkman, R.M.'), byRaw.get('Dijkman, Remco'));
  assert.equal(people.get(byRaw.get('Dijkman, R.M.')!)!.name, 'Remco M. Dijkman');
  assert.equal(byRaw.get('Türetken, Oktay'), byRaw.get('Turetken, O.'));
  assert.equal(byRaw.get('Boer, Arjen-Kars'), byRaw.get('Boer, Arjen Kars'));
  assert.notEqual(byRaw.get('Zhang, Y.'), byRaw.get('Zhang, Yingqian'));
  assert.notEqual(byRaw.get('Zhang, Yu'), byRaw.get('Zhang, Yingqian'));
});

test('Names: aliases for nicknames', () => {
  const { byRaw } = buildPeople(new Map([['Poutré, la, J.A.', 5], ['La Poutré, Han', 2]]), { 'Poutré, la, J.A.': 'La Poutré, Han' });
  assert.equal(byRaw.get('Poutré, la, J.A.'), byRaw.get('La Poutré, Han'));
});

test('Types: Dutch and English Pure types map to one category', () => {
  assert.equal(classifyType('Tijdschriftartikel', 'JOUR').category, 'journal');
  assert.equal(classifyType('Article', 'JOUR').category, 'journal');
  assert.equal(classifyType('Dissertatie 1 (Onderzoek TU/e / Promotie TU/e)', 'THES').category, 'thesis');
  assert.equal(classifyType('Conferentiebijdrage', 'GEN').label, 'Conferentiebijdrage');
  assert.equal(classifyType('Iets nieuws', 'CHAP').category, 'book');
});

test('Venues: conference editions share a key', () => {
  const keys = [
    '21st International Conference on Business Process Management, BPM 2023',
    '13th International Conference on Business Process Management (BPM 2015)',
    'BPM 2007',
  ].map((s) => conferenceRef(s)!.key);
  assert.deepEqual(new Set(keys).size, 1);
  assert.equal(conferenceRef('2019 IEEE International Conference on Fuzzy Systems (FUZZ-IEEE 2019)')!.key, conferenceRef('IEEE International Conference on Fuzzy Systems (FUZZ 2018)')!.key);
  assert.equal(publisherRef('Springer-Verlag')!.name, 'Springer');
  assert.equal(seriesRef('Lecture Notes in Computer Science (including subseries Lecture Notes in Artificial Intelligence and Lecture Notes in Bioinformatics)')!.name, 'Lecture Notes in Computer Science');
});

test('Model: links are restricted to http(s), dates sort correctly', () => {
  const ds = buildDataset({ id: 't', label: 't', source: 't' }, parseRis(
    'TY  - JOUR\nT1  - A\nPY  - 2026/3\nUR  - javascript:alert(1)\nUR  - https://www.scopus.com/pages/publications/1\nER  - \n' +
    'TY  - JOUR\nT1  - B\nPY  - 2026/10/1\nER  - \n',
  ));
  assert.equal(ds.pubs[0].url, undefined);
  assert.ok(ds.pubs[0].scopusUrl?.startsWith('https://www.scopus.com/'));
  assert.ok(ds.pubs[1].sortDate > ds.pubs[0].sortDate);
});

function xlsx(sheets: Record<string, string>): Uint8Array {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(`<workbook><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
    'xl/sharedStrings.xml': strToU8('<sst><si><t>VAKCODE</t></si><si><r><t>Vak</t></r><r><t>naam</t></r><rPh><t>x</t></rPh></si></sst>'),
  };
  names.forEach((n, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<worksheet><sheetData>${sheets[n]}</sheetData></worksheet>`)));
  return zipSync(files);
}
const c = (ref: string, v: string | number) => (typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`);

test('XLSX reader: shared/inline strings, self-closing rows, phonetic runs', () => {
  const wb = readXlsx(xlsx({ A: `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"/><row r="3">${c('C3', 3.5)}${c('A3', 'x &amp; y')}</row>` }));
  assert.deepEqual(wb.sheets[0].rows[0], ['VAKCODE', 'Vaknaam']);
  assert.deepEqual(wb.sheets[0].rows[2], ['x & y', null, 3.5]);
});

test('ECTS parser handles other years (2026–2027) and skips total rows', () => {
  const head = ['VAKCODE', 'VAKNAAM', 'groep', '%', 'Enroll 26', 'Def aantal 26', 'ECTS 26', 'niet ieis', 'IEIS 26', 'Enroll 27', 'Def aantal 27', 'ECTS 27', 'niet IEIS2', 'IEIS 27'];
  const cols = 'ABCDEFGHIJKLMN'.split('');
  const row = (r: number, vals: (string | number)[]) => `<row r="${r}">${vals.map((v, i) => c(`${cols[i]}${r}`, v)).join('')}</row>`;
  const bytes = xlsx({
    'EC 2026-2027': row(1, head) + row(2, ['1AB00', 'Test', 'is', 100, 10, 9, 45, 0, 45, 12, 11, 55, 0, 55]) + row(3, ['', '', '', '', 0, 0, 999, 0, 999]),
    Totals: row(1, ['Som van IEIS 27']) + row(2, ['Rijlabels']) + row(3, ['IS', 55]) + row(4, ['Eindtotaal', 55]),
  });
  const cand = ingestBytes('ects.xlsx', bytes);
  assert.equal(cand.kind, 'ects');
  const p = cand.payload as { years: number[]; courses: { group: string; years: Record<string, { ieis: number; other: number }> }[]; checks: { ok: boolean }[] };
  assert.deepEqual(p.years, [2026, 2027]);
  assert.equal(p.courses.length, 1);
  assert.equal(p.courses[0].group, 'IS');
  assert.equal(p.courses[0].years['2027'].ieis, 55);
  assert.equal(p.courses[0].years['2027'].other, 0);
  assert.ok(p.checks.length === 1 && p.checks[0].ok);
});

/* ───────────── Cloudflare Access token ───────────── */

const b64url = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

async function rsaKey(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { kid, pair, jwk: { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' } };
}

async function sign(key: Awaited<ReturnType<typeof rsaKey>>, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const h = b64url({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const p = b64url(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}

const TEAM = 'isdashboard.cloudflareaccess.com';
const AUD = '4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2';
const NOW = 1_800_000_000;
const claims = { iss: `https://${TEAM}`, aud: [AUD], email: 'R.Dijkman@TUE.nl', exp: NOW + 8 * 3600, iat: NOW, nbf: NOW, type: 'app', sub: 'user-1' };

function keyServer(keys: { jwk: object }[]) {
  const state = { keys, fetches: 0 };
  const fetcher: Fetcher = async (url) => {
    state.fetches++;
    assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: state.keys.map((k) => k.jwk) }), { headers: { 'content-type': 'application/json' } });
  };
  return { state, fetcher };
}

const rejects = (p: Promise<unknown>, reason: string) => assert.rejects(p, (e: unknown) => e instanceof AccessError && e.message === reason, reason);

test('Access token: valid tokens pass, keys are cached', async () => {
  resetKeyCache();
  const k1 = await rsaKey('k1');
  const { state, fetcher } = keyServer([k1]);
  const cfg = { teamDomain: `https://${TEAM}/`, aud: AUD };
  const id = await verifyAccessToken(await sign(k1, claims), cfg, { now: NOW, fetcher });
  assert.equal(id.email, 'r.dijkman@tue.nl');
  await verifyAccessToken(await sign(k1, { ...claims, aud: AUD }), cfg, { now: NOW, fetcher });
  await verifyAccessToken(await sign(k1, { ...claims, exp: NOW - 30, type: undefined }), cfg, { now: NOW, fetcher });
  assert.equal(state.fetches, 1);
});

test('Access token: expired, wrong audience/issuer, wrong type and missing e-mail are rejected', async () => {
  resetKeyCache();
  const k1 = await rsaKey('k1');
  const { fetcher } = keyServer([k1]);
  const v = async (c: Record<string, unknown>) => verifyAccessToken(await sign(k1, c), { teamDomain: TEAM, aud: AUD }, { now: NOW, fetcher });
  await rejects(v({ ...claims, exp: NOW - 61 }), 'expired');
  await rejects(v({ ...claims, exp: undefined }), 'expired');
  await rejects(v({ ...claims, nbf: NOW + 120 }), 'not yet valid');
  await rejects(v({ ...claims, aud: ['someone-else'] }), 'audience');
  await rejects(v({ ...claims, aud: undefined }), 'audience');
  await rejects(v({ ...claims, iss: 'https://evil.cloudflareaccess.com' }), 'issuer');
  await rejects(v({ ...claims, iss: `http://${TEAM}` }), 'issuer');
  await rejects(v({ ...claims, type: 'org' }), 'token type');
  await rejects(v({ ...claims, email: undefined }), 'no email');
  await rejects(verifyAccessToken(await sign(k1, claims), { teamDomain: TEAM, aud: '' }, { now: NOW, fetcher }), 'not configured');
});

test('Access token: bad signatures and other algorithms are rejected', async () => {
  resetKeyCache();
  const k1 = await rsaKey('k1');
  const { fetcher } = keyServer([k1]);
  const v = (t: string) => verifyAccessToken(t, { teamDomain: TEAM, aud: AUD }, { now: NOW, fetcher });
  const [h, , s] = (await sign(k1, claims)).split('.');
  await rejects(v(`${h}.${b64url({ ...claims, email: 'boss@tue.nl' })}.${s}`), 'signature');
  await rejects(v(await sign(await rsaKey('k1'), claims)), 'signature');
  await rejects(v(`${b64url({ alg: 'none', kid: 'k1' })}.${b64url(claims)}.`), 'algorithm');
  await rejects(v(`${b64url({ alg: 'HS256', kid: 'k1' })}.${b64url(claims)}.${b64url('mac')}`), 'algorithm');
  await rejects(v(`${b64url({ alg: 'RS256' })}.${b64url(claims)}.${s}`), 'kid');
  await rejects(v('not-a-token'), 'malformed');
  await rejects(v(`${h}.${b64url(claims)}.@@@`), 'encoding');
  await rejects(v(`${h}.@@@.${s}`), 'signature');
});

test('Access token: unknown key id triggers one refetch (rate-limited)', async () => {
  resetKeyCache();
  const k1 = await rsaKey('k1');
  const k2 = await rsaKey('k2');
  const { state, fetcher } = keyServer([k1]);
  const v = async (k: Awaited<ReturnType<typeof rsaKey>>, now: number) => verifyAccessToken(await sign(k, { ...claims, exp: now + 3600 }), { teamDomain: TEAM, aud: AUD }, { now, fetcher });
  await v(k1, NOW);
  assert.equal(state.fetches, 1);
  state.keys = [k1, k2];
  await v(k2, NOW + 60);
  assert.equal(state.fetches, 2, 'rotated key is fetched');
  await rejects(v(await rsaKey('k3'), NOW + 70), 'unknown key');
  assert.equal(state.fetches, 2, 'no refetch within 30 s');
  await rejects(v(await rsaKey('k3'), NOW + 200), 'unknown key');
  assert.equal(state.fetches, 3);
  await v(k1, NOW + 200 + 3601);
  assert.equal(state.fetches, 4, 'keys expire after an hour');
});

test('Access setup helpers: team domain normalisation and unverified peek', () => {
  assert.equal(normalizeTeamDomain(' https://IsDashboard.cloudflareaccess.com/ '), 'isdashboard.cloudflareaccess.com');
  assert.equal(normalizeTeamDomain(undefined), '');
  assert.deepEqual(peekToken(`x.${b64url(claims)}.y`), { iss: claims.iss, aud: [AUD], email: 'r.dijkman@tue.nl' });
  assert.deepEqual(peekToken(null), {});
});

/* ───────────── storage format and API rules ───────────── */

test('Payload codec: gzip + base64 round-trip', async () => {
  const payload = { records: Array.from({ length: 2000 }, (_, i) => ({ TY: ['JOUR'], T1: [`Titel ${i} — ëüß ✓ 漢字`], AU: ['Dijkman, R.M.'] })) };
  const b64 = await encodePayload(payload);
  assert.ok(/^[A-Za-z0-9+/]+=*$/.test(b64) && b64.length % 4 === 0);
  assert.ok(b64.length < JSON.stringify(payload).length / 4, 'compressed');
  assert.deepEqual(await decodePayload(b64), payload);
  const bytes = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 7919) % 256);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  await assert.rejects(decodePayload(toBase64(bytes)));
});

test('Chunks: split, expected lengths and base64 validation', () => {
  const big = 'QUJD'.repeat((LIMITS.chunk * 2 + 1000) / 4).slice(0, -2) + '==';
  const parts = splitChunks(big, LIMITS.chunk);
  assert.equal(parts.length, 3);
  assert.equal(chunkCount(big.length), 3);
  assert.equal(parts.join(''), big);
  parts.forEach((p, i) => assert.ok(validPart(p, big.length, i), `part ${i}`));
  assert.equal(partLength(big.length, 3), -1);
  assert.ok(!validPart(parts[0].slice(1), big.length, 0), 'short part');
  assert.ok(!validPart(parts[2], big.length, 1), 'wrong index');
  assert.ok(!validPart('AB==' + parts[2].slice(4), big.length, 2), 'padding in the middle');
  assert.ok(!validPart(parts[2].slice(0, -4) + '<a>', big.length, 2), 'not base64');
  assert.ok(!validPart('QUJD', 8, 0) && validPart('QUJDRA==', 8, 0));
  assert.ok(!validPart(['QUJD'], 4, 0));
});

test('API rules: dataset metadata, e-mail domains', () => {
  const ok = parseNewDataset({ kind: 'pure', label: '  IS 2020–2025\n', source: 'is.ris', years: '2020–2025', rows: 12, notes: ['a'], bytes: 400 });
  assert.equal(ok.label, 'IS 2020–2025');
  const bad = (v: Record<string, unknown>, status = 400) => assert.throws(() => parseNewDataset({ kind: 'ects', label: 'x', source: 'y', years: '–', rows: 1, notes: [], bytes: 8, ...v }), (e: unknown) => e instanceof HttpError && e.status === status);
  bad({ kind: 'secret' });
  bad({ rows: 1.5 });
  bad({ bytes: 6 });
  bad({ bytes: LIMITS.total + 4 }, 413);
  bad({ label: 'x'.repeat(LIMITS.label + 1) });
  bad({ label: '' });
  bad({ notes: 'a' });
  bad({ notes: [1] });
  assert.equal(parseEmail(' R.Dijkman@TUE.nl '), 'r.dijkman@tue.nl');
  assert.equal(parseEmail('iemand@gmail.com'), 'iemand@gmail.com');
  assert.throws(() => parseEmail('geen adres'));
  assert.ok(emailAllowed('a@example.org', ['tue.nl', 'example.org']) && !emailAllowed('a@xtue.nl', ['tue.nl']));
  assert.ok(!emailAllowed('x@student.tue.nl', ['tue.nl']), 'subdomains are not trusted domains');
});

test('API rules: addresses outside the trusted domains need an explicit confirmation', () => {
  const domains = ['tue.nl'];
  const admins = ['beheer@example.org'];
  const needsConfirm = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof HttpError && e.status === 400 && e.body.error === 'external');
  assert.equal(checkExternal('a@tue.nl', domains, admins, undefined), false);
  assert.equal(checkExternal('beheer@example.org', domains, admins, undefined), false);
  needsConfirm(() => checkExternal('iemand@gmail.com', domains, admins, undefined));
  needsConfirm(() => checkExternal('x@student.tue.nl', domains, admins, false));
  needsConfirm(() => checkExternal('x@tue.nl.evil.com', domains, admins, 'true'));
  assert.equal(checkExternal('iemand@gmail.com', domains, admins, true), true);
});

for (const [name, fn] of tests) {
  await fn();
  n++;
  console.log(`✓ ${name}`);
}
console.log(`\n${n} tests geslaagd`);
