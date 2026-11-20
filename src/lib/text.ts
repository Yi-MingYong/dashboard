/** Text helpers shared by normalisation and search. */

const SPECIAL: Record<string, string> = {
  ß: 'ss', æ: 'ae', Æ: 'ae', ø: 'o', Ø: 'o', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', ı: 'i', œ: 'oe', Œ: 'oe', þ: 'th',
};

/** Lowercase, strip diacritics and normalise a few special letters. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ßæÆøØłŁđĐıœŒþ]/g, (c) => SPECIAL[c] ?? c)
    .toLowerCase();
}

/** Folded string with only letters/digits and single spaces. */
export function foldKey(s: string): string {
  return fold(s)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Pick the most frequent display variant; ties go to the longest. */
export function bestVariant(counts: Map<string, number>): string {
  let best = '';
  let bestN = -1;
  for (const [v, n] of counts) {
    if (n > bestN || (n === bestN && v.length > best.length)) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

export function bump<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}
