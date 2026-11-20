/** Normalisation of journals, conferences, publishers and book series. */
import { collapse, foldKey } from './text';

export interface VenueRef {
  key: string;
  name: string;
}

export function journalRef(name: string | undefined): VenueRef | undefined {
  if (!name) return undefined;
  const clean = collapse(name).replace(/\s*\(\s*print\s*\)$/i, '');
  const key = foldKey(clean).replace(/^the /, '');
  return key ? { key, name: clean } : undefined;
}

const NOT_ACRONYMS = new Set(['IEEE', 'ACM', 'IFIP', 'LNCS', 'LNBIP', 'LNAI', 'CEUR', 'AAAI', 'SIAM', 'EU', 'USA', 'UK', 'NL', 'CCIS']);

const ORDINAL_WORDS =
  'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth';

/** Strip years, ordinals and boilerplate so yearly editions share a key. */
function cleanEventName(s: string): string {
  return collapse(
    s
      .replace(/\(([^)]*)\)/g, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/[’']\d{2}\b/g, ' ')
      .replace(/\b\d+(st|nd|rd|th)\b/gi, ' ')
      .replace(new RegExp(`\\b((twenty|thirty|forty|fifty)[- ])?(${ORDINAL_WORDS})\\b`, 'gi'), ' ')
      .replace(/^\s*(proceedings( of)?( the)?|proc\.)\s*/i, ' ')
      .replace(/\b(\d{1,2}\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b.*$/i, ' ')
      .replace(/[,:;–-]\s*$/, ' ')
      .replace(/^\s*[,:;–-]\s*/, ' '),
  ).replace(/^(the|an?)\s+/i, '');
}

const ACR = String.raw`(?:IEEE[\s-])?[A-Z][A-Za-z0-9&/+.-]*[A-Z0-9][A-Za-z0-9&/+.-]*`;
const PAREN_ACR = new RegExp(String.raw`\((${ACR})(?:[\s'’-]*\d{2,4})?\)`, 'g');
const TRAIL_ACR = new RegExp(String.raw`,\s*(${ACR})(?:[\s'’-]*\d{2,4})?\s*$`);

function acronymKey(acr: string): string {
  return acr.toUpperCase().replace(/^IEEE[\s-]*/, '').replace(/[\s-]*IEEE$/, '').replace(/[.-]+$/, '');
}

function plausibleAcronym(a: string): boolean {
  const core = acronymKey(a);
  return core.length >= 2 && core.length <= 16 && !NOT_ACRONYMS.has(core) && /[A-Z].*[A-Z]/.test(a.replace(/^IEEE\s*/, ''));
}

/**
 * Conference key. Prefers an acronym ("(BPM 2023)", "…, CAiSE 2021", "OTM 2007, …"),
 * otherwise a cleaned event name, so yearly editions are counted together.
 */
export function conferenceRef(event: string | undefined): VenueRef | undefined {
  if (!event) return undefined;
  const raw = collapse(event).replace(/\s+,/g, ',');
  let acr: string | undefined;
  let base = raw;

  const paren = [...raw.matchAll(PAREN_ACR)].map((m) => m[1]).filter(plausibleAcronym);
  if (paren.length) acr = paren[paren.length - 1];
  const trail = TRAIL_ACR.exec(raw);
  if (!acr && trail && plausibleAcronym(trail[1])) {
    acr = trail[1];
    base = raw.slice(0, trail.index);
  }
  let name = cleanEventName(base).replace(/[,\s]+\d{1,2}$/, '').replace(/[,;:\s]+$/, '') || raw;
  if (acr) return { key: `acr:${acronymKey(acr)}`, name: `${acr.replace(/[.-]+$/, '')} · ${name}` };

  // Leading acronym + year: "OTM 2007, Vilamoura", "CAiSE'08", "BPM 2023 Workshops"
  const lead = /^([A-Z][A-Za-z0-9&]*[A-Z0-9])\s*['’]?\s*(?:19|20)?\d{2}\b(.*)$/.exec(raw);
  if (lead && plausibleAcronym(lead[1])) {
    const ws = /workshop/i.test(lead[2]);
    const label = ws ? `${lead[1]} Workshops` : lead[1];
    return { key: `acr:${acronymKey(label)}`, name: label };
  }
  name = name.replace(/^(the|an?)\s+/i, '');
  const key = foldKey(name);
  return key ? { key, name } : undefined;
}

const PUBLISHER_RULES: [RegExp, string][] = [
  [/springer/i, 'Springer'],
  [/elsevier|pergamon|north[- ]holland|academic press/i, 'Elsevier'],
  [/\bieee\b|institute of electrical and electronics engineers/i, 'IEEE'],
  [/\bacm\b|association for computing machinery/i, 'ACM'],
  [/wiley/i, 'Wiley'],
  [/taylor|francis|routledge|crc press/i, 'Taylor & Francis'],
  [/\bceur\b|ceur-ws/i, 'CEUR-WS'],
  [/ios press/i, 'IOS Press'],
  [/\bigi\b/i, 'IGI Global'],
  [/\bmdpi\b/i, 'MDPI'],
  [/sage/i, 'SAGE'],
  [/emerald/i, 'Emerald'],
  [/informs/i, 'INFORMS'],
  [/arxiv/i, 'arXiv'],
  [/scitepress|insticc/i, 'SciTePress'],
  [/association for information systems|\bais\b|aisel/i, 'AIS'],
  [/technische universiteit eindhoven|eindhoven university of technology|\btu\/e\b/i, 'TU/e'],
  [/schloss dagstuhl|dagstuhl/i, 'Schloss Dagstuhl'],
  [/gesellschaft f(ü|u)r informatik/i, 'Gesellschaft für Informatik'],
  [/oxford university press/i, 'Oxford University Press'],
  [/cambridge university press/i, 'Cambridge University Press'],
  [/kluwer/i, 'Kluwer'],
  [/inderscience/i, 'Inderscience'],
  [/\baaai\b/i, 'AAAI'],
  [/de gruyter/i, 'De Gruyter'],
  [/frontiers/i, 'Frontiers'],
  [/\bplos\b|public library of science/i, 'PLOS'],
  [/nature publishing|nature research/i, 'Nature Portfolio'],
];

export function publisherRef(pb: string | undefined): VenueRef | undefined {
  if (!pb) return undefined;
  const raw = collapse(pb);
  for (const [re, name] of PUBLISHER_RULES) if (re.test(raw)) return { key: foldKey(name), name };
  const name = raw
    .replace(/\.\s+(org|com|net|nl|eu)\b/gi, '.$1')
    .replace(/,?\s*(inc|ltd|b\.?v|gmbh|llc|s\.?a|co)\.?$/i, '')
    .trim();
  return { key: foldKey(name), name };
}

export function seriesRef(t3: string | undefined): VenueRef | undefined {
  if (!t3) return undefined;
  let name = collapse(t3)
    .replace(/\s*\((including|incl\.)[^)]*\)/i, '')
    .replace(/\s*\((LNCS|LNAI|LNBIP|CCIS|AISC|LNNS|SCI)\)/i, '')
    .replace(/[;,.]\s*$/, '');
  if (/^lecture notes in artificial intelligence/i.test(name)) name = 'Lecture Notes in Artificial Intelligence';
  const key = foldKey(name);
  return key ? { key, name } : undefined;
}
