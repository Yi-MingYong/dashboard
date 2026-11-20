/**
 * Author-name disambiguation.
 *
 * Pure exports contain the same person under several spellings, e.g.
 *   "Aalst, van der, W.M.P."  ·  "van der Aalst, Wil M.P."
 *   "Dijkman, R.M."           ·  "Dijkman, Remco M."  ·  "Dijkman, Remco"
 * We merge variants that share a surname (particles and diacritics ignored)
 * and a compatible first name / initials. Initials-only variants are only
 * attached to a full-name variant when exactly one candidate fits, so two
 * different "Y. Zhang"s are never merged blindly. Cases that cannot be
 * resolved automatically (nicknames such as Rik ↔ H. Eshuis) are handled by
 * `data/aliases.json`.
 */
import { bump, collapse, fold } from './text';

const PARTICLES = new Set([
  'van', 'der', 'den', 'de', 'het', 'ter', 'ten', 'te', "'t", 't', 'von', 'zu', 'da', 'di', 'del', 'della',
  'dos', 'das', 'du', 'la', 'le', 'op', 'in', 'aan', 'bij', 'uit', 'vd', "van't", "d'",
]);

const isParticle = (t: string) => PARTICLES.has(fold(t));

export interface ParsedName {
  raw: string;
  surname: string; // without particles, as written
  prefix: string; // particles, as written ("van der")
  given: string; // as written ("Wil M.P.")
  firstName: string; // folded first given name (letters only) if written in full, else ''
  givenJoined: string; // all written-out given names, folded and joined ("arjenkars")
  initials: string[]; // ["W", "M", "P"]
  surnameKey: string; // folded prefix+surname, letters only
}

export function parseName(input: string): ParsedName {
  const raw = collapse(input);
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  let surnamePart = '';
  let prefix = '';
  let given = '';

  if (parts.length >= 3 && parts[1].split(/\s+/).every(isParticle)) {
    // Legacy Pure style: "Aalst, van der, W.M.P."
    surnamePart = parts[0];
    prefix = parts[1];
    given = parts.slice(2).join(' ');
  } else if (parts.length >= 2) {
    surnamePart = parts[0];
    given = parts.slice(1).join(' ');
  } else {
    // "Given Surname" without comma
    const toks = raw.split(/\s+/);
    if (toks.length === 1) {
      surnamePart = raw;
    } else {
      let i = toks.length - 1;
      while (i > 0 && isParticle(toks[i - 1])) i--;
      surnamePart = toks.slice(i).join(' ');
      given = toks.slice(0, i).join(' ');
    }
  }

  // Trailing particles in the given name: "Beest, Nick van"
  const gTokens = given.split(/\s+/).filter(Boolean);
  const trailing: string[] = [];
  while (gTokens.length > 1 && isParticle(gTokens[gTokens.length - 1])) trailing.unshift(gTokens.pop()!);
  given = gTokens.join(' ');

  // Leading particles in the surname: "van der Aalst", "Van Gorp"
  const sTokens = surnamePart.split(/\s+/).filter(Boolean);
  const lead: string[] = [];
  while (sTokens.length > 1 && isParticle(sTokens[0])) lead.push(sTokens.shift()!);
  const surname = sTokens.join(' ');
  prefix = [prefix, ...lead, ...trailing].filter(Boolean).join(' ');

  // Nickname in parentheses: "W.M.P. (Wil)"
  let nick = '';
  given = given.replace(/\(([^)]+)\)/g, (_, n: string) => {
    nick = n.trim();
    return ' ';
  });
  given = collapse(given);

  const tokens = given
    .replace(/\./g, '. ')
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, ''))
    .filter(Boolean);
  const initials = tokens.map((t) => fold(t).charAt(0).toUpperCase()).filter(Boolean);
  const first = tokens[0] ?? '';
  const isWord = (t: string) => t.length >= 2 && /[a-zà-ÿ]/.test(t) && !/^[A-Z]{2,}$/.test(t);
  const isFull = isWord(first);
  const letters = (t: string) => fold(t).replace(/[^a-z]/g, '');
  const firstName = nick ? letters(nick.split(/\s+/)[0]) : isFull ? letters(first) : '';
  const givenJoined = nick ? letters(nick) : tokens.filter(isWord).map(letters).join('');

  return {
    raw,
    surname,
    prefix,
    given: nick && !isFull ? nick : given,
    firstName,
    givenJoined,
    initials: nick && !initials.length ? [fold(nick).charAt(0).toUpperCase()] : initials,
    surnameKey: fold(prefix + surname).replace(/[^a-z]/g, ''),
  };
}

export function displayName(p: ParsedName): string {
  return collapse([p.given, p.prefix, p.surname].join(' ')) || p.raw;
}

export function sortName(p: ParsedName): string {
  return fold(`${p.surname} ${p.given} ${p.prefix}`);
}

function compatibleInitials(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return true;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface Person {
  id: string;
  name: string;
  sortKey: string;
  variants: Map<string, number>; // raw spelling -> occurrences
}

interface Cluster {
  firstName: string;
  initials: string[][];
  variants: Map<string, number>;
  parsed: ParsedName[];
}

/**
 * Build the person register for a set of raw author strings.
 * Returns a map from raw spelling to person id plus the register itself.
 */
export function buildPeople(
  occurrences: Map<string, number>,
  aliases: Record<string, string> = {},
): { byRaw: Map<string, string>; people: Map<string, Person> } {
  const aliasMap = new Map(Object.entries(aliases).map(([k, v]) => [fold(collapse(k)), collapse(v)]));
  const canonicalOf = (raw: string) => aliasMap.get(fold(collapse(raw))) ?? collapse(raw);

  // Group raw spellings by surname key (after aliasing).
  const groups = new Map<string, { raw: string; canon: ParsedName; n: number }[]>();
  for (const [raw, n] of occurrences) {
    const canon = parseName(canonicalOf(raw));
    const list = groups.get(canon.surnameKey) ?? [];
    list.push({ raw, canon, n });
    groups.set(canon.surnameKey, list);
  }

  const byRaw = new Map<string, string>();
  const people = new Map<string, Person>();

  for (const [surnameKey, items] of groups) {
    const full: Cluster[] = [];
    const initialsOnly: Cluster[] = [];
    const newCluster = (it: (typeof items)[number]): Cluster => ({
      firstName: it.canon.firstName,
      initials: [it.canon.initials],
      variants: new Map([[it.raw, it.n]]),
      parsed: [it.canon],
    });
    const add = (c: Cluster, it: (typeof items)[number]) => {
      c.initials.push(it.canon.initials);
      bump(c.variants, it.raw, it.n);
      c.parsed.push(it.canon);
    };

    // 1. Full first names cluster on the folded first name; "Arjen-Kars" and
    //    "Arjen Kars", or "Mohammad Reza" and "Mohammadreza", end up together.
    const sameGiven = (c: Cluster, p: ParsedName) =>
      c.firstName === p.firstName ||
      c.parsed.some((q) => q.givenJoined === p.givenJoined || q.givenJoined === p.firstName || q.firstName === p.givenJoined);
    for (const it of items.filter((i) => i.canon.firstName)) {
      const c = full.find((f) => sameGiven(f, it.canon));
      if (c) add(c, it);
      else full.push(newCluster(it));
    }
    // 2. Initials-only spellings join the single compatible full-name cluster.
    const rest = items
      .filter((i) => !i.canon.firstName)
      .sort((a, b) => b.canon.initials.length - a.canon.initials.length || b.n - a.n);
    for (const it of rest) {
      const fits = (c: Cluster) => c.initials.some((ini) => compatibleInitials(ini, it.canon.initials));
      const candidates = full.filter(fits);
      if (candidates.length === 1) {
        add(candidates[0], it);
        continue;
      }
      if (candidates.length > 1) {
        // Several people fit: only decide when one matches clearly more initials
        // ("J.J.M." → "Jos J.M." rather than "Joseph"); otherwise keep apart.
        const score = (c: Cluster) =>
          Math.max(...c.initials.filter((ini) => compatibleInitials(ini, it.canon.initials)).map((ini) => Math.min(ini.length, it.canon.initials.length)));
        const ranked = candidates.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s);
        if (ranked[0].s >= 2 && ranked[0].s > ranked[1].s) add(ranked[0].c, it);
        else initialsOnly.push(newCluster(it));
        continue;
      }
      const others = initialsOnly.filter(fits);
      if (others.length === 1) add(others[0], it);
      else initialsOnly.push(newCluster(it));
    }

    for (const c of [...full, ...initialsOnly]) {
      // Display: the most frequent spelling that has a full first name.
      const scored = c.parsed
        .map((p) => ({ p, n: c.variants.get(items.find((i) => i.canon === p)!.raw) ?? 0 }))
        .sort(
          (a, b) =>
            Number(!!b.p.firstName) - Number(!!a.p.firstName) ||
            b.n - a.n ||
            b.p.given.length - a.p.given.length,
        );
      const best = scored[0].p;
      const tail = c.firstName || best.initials.join('').toLowerCase() || 'x';
      let id = `${surnameKey}-${fold(tail).replace(/[^a-z]/g, '')}`;
      for (let k = 2; people.has(id); k++) id = `${surnameKey}-${tail}${k}`;
      people.set(id, { id, name: displayName(best), sortKey: sortName(best), variants: c.variants });
      for (const raw of c.variants.keys()) byRaw.set(raw, id);
    }
  }
  return { byRaw, people };
}
