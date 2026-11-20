/** Chart tokens, read from the CSS custom properties so charts and UI share one palette. */
import { createContext, useContext } from 'react';

export interface ChartTokens {
  panel: string;
  panel2: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  line: string;
  line2: string;
  gray: string;
  red: string;
  slate: string;
  sans: string;
  mono: string;
}

export function readTokens(): ChartTokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    panel: v('--panel'),
    panel2: v('--panel-2'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    ink4: v('--ink-4'),
    line: v('--line'),
    line2: v('--line-2'),
    gray: v('--gray'),
    red: v('--red'),
    slate: v('--slate'),
    sans: v('--sans'),
    mono: v('--mono'),
  };
}

export const ThemeContext = createContext<ChartTokens | null>(null);

export function useTokens(): ChartTokens {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('ThemeContext ontbreekt');
  return t;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Shared tooltip chrome: white panel, hairline border, square corners. */
export function tooltipBase(t: ChartTokens) {
  return {
    backgroundColor: t.panel,
    borderColor: t.line,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.ink, fontFamily: t.sans, fontSize: 12 },
    extraCssText: 'border-radius:0;box-shadow:0 6px 18px rgba(17,20,24,.12);',
    confine: true,
  };
}

export function axisBase(t: ChartTokens) {
  return {
    axisLine: { lineStyle: { color: t.gray } },
    axisTick: { show: false },
    axisLabel: { color: t.ink4, fontFamily: t.mono, fontSize: 10.5 },
    splitLine: { lineStyle: { color: t.line2, type: 'solid' as const, width: 1 } },
  };
}

/** Tooltip row: square key, label, value (mono, strong). */
export function tipRow(color: string, label: string, value: string, muted = false): string {
  return `<div style="display:flex;align-items:center;gap:8px;line-height:1.75${muted ? ';opacity:.5' : ''}">
    <span style="display:inline-block;width:8px;height:8px;background:${color}"></span>
    <span style="flex:1">${esc(label)}</span>
    <strong style="font-family:'IBM Plex Mono',monospace;font-weight:500;margin-left:14px">${esc(value)}</strong></div>`;
}

export function tipTitle(s: string): string {
  return `<div style="font-weight:600;margin-bottom:4px">${esc(s)}</div>`;
}
