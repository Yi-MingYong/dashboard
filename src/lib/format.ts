const nf = new Intl.NumberFormat('nl-NL');
const nf1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pf = new Intl.NumberFormat('nl-NL', { style: 'percent', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('nl-NL', { notation: 'compact', maximumFractionDigits: 1 });

export const fmt = (n: number) => nf.format(n);
export const fmt1 = (n: number) => nf1.format(n);
export const pct = (n: number) => pf.format(n);
export const fmtCompact = (n: number) => (Math.abs(n) >= 10000 ? compact.format(n) : nf.format(n));

export function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

export function yearSpan(a: number | null, b: number | null): string {
  if (a == null || b == null) return '–';
  return a === b ? String(a) : `${a}–${b}`;
}
