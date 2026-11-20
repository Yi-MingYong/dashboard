/** ECharts option builders in the dashboard's visual language: square marks, hairlines, mono axes. */
import type { EChartsCoreOption } from 'echarts/core';
import { fmt, fmt1 } from '../lib/format';
import { axisBase, esc, tipRow, tipTitle, tooltipBase, type ChartTokens } from './theme';

export interface Series {
  name: string;
  color: string;
  data: number[];
}

export const CURRENT_YEAR = new Date().getFullYear();

const grid = { left: 4, right: 8, top: 22, bottom: 2, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' };

const yearLabel = (y: number) => (y === CURRENT_YEAR ? `${y}*` : String(y));

/** Stacked columns per year with the total printed above each column (when there is room). */
export function stackedYears(t: ChartTokens, years: number[], series: Series[]): EChartsCoreOption {
  const totals = years.map((_, i) => series.reduce((a, s) => a + s.data[i], 0));
  const showTotals = years.length <= 18;
  const partial = years.map((y) => y === CURRENT_YEAR);
  return {
    animationDuration: 250,
    grid: { ...grid, top: showTotals ? 22 : 10 },
    tooltip: {
      ...tooltipBase(t),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(17,20,24,0.04)' } },
      formatter: (ps: { dataIndex: number; seriesIndex: number; value: number }[]) => {
        if (!ps.length) return '';
        const i = ps[0].dataIndex;
        const rows = [...ps].reverse().map((p) => tipRow(series[p.seriesIndex].color, series[p.seriesIndex].name, fmt(Number(p.value) || 0), !p.value));
        return (
          tipTitle(`${years[i]}${partial[i] ? ' · lopend jaar' : ''}`) +
          rows.join('') +
          `<div style="border-top:1px solid ${t.line2};margin-top:4px;padding-top:4px;display:flex"><span style="flex:1">Totaal</span><strong style="font-family:'IBM Plex Mono',monospace;font-weight:500">${fmt(totals[i])}</strong></div>`
        );
      },
    },
    xAxis: {
      type: 'category',
      data: years.map(yearLabel),
      ...axisBase(t),
      axisLabel: { ...axisBase(t).axisLabel, color: t.ink2, fontSize: 11, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: { type: 'value', minInterval: 1, splitNumber: 3, ...axisBase(t), axisLine: { show: false } },
    series: series.map((s, si) => ({
      name: s.name,
      type: 'bar',
      stack: 'total',
      barCategoryGap: years.length <= 8 ? '42%' : '24%',
      barMaxWidth: 120,
      color: s.color,
      data: s.data.map((v, i) => ({
        value: v,
        itemStyle: { color: s.color, opacity: partial[i] ? 0.55 : 1, borderColor: t.panel, borderWidth: v ? 0.5 : 0 },
      })),
      label:
        showTotals && si === series.length - 1
          ? {
              show: true,
              position: 'top',
              distance: 4,
              color: t.ink,
              fontFamily: t.mono,
              fontSize: 11,
              fontWeight: 500,
              formatter: (p: { dataIndex: number }) => (totals[p.dataIndex] ? fmt(totals[p.dataIndex]) : ''),
            }
          : undefined,
      emphasis: { focus: 'series' },
    })),
  };
}

/** Single-series columns. */
export function columns(t: ChartTokens, labels: string[], values: number[], name: string, opts: { color?: string; partialLast?: boolean; valueLabels?: boolean } = {}): EChartsCoreOption {
  const color = opts.color ?? t.slate;
  return {
    animationDuration: 250,
    grid: { ...grid, top: opts.valueLabels ? 20 : 10 },
    tooltip: {
      ...tooltipBase(t),
      trigger: 'item',
      formatter: (p: { dataIndex: number; value: number }) => tipTitle(labels[p.dataIndex]) + tipRow(color, name, fmt(p.value)),
    },
    xAxis: { type: 'category', data: labels, ...axisBase(t), axisLabel: { ...axisBase(t).axisLabel, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: 'value', minInterval: 1, splitNumber: 3, ...axisBase(t), axisLine: { show: false } },
    series: [
      {
        name,
        type: 'bar',
        barMaxWidth: 28,
        data: values.map((v, i) => ({
          value: v,
          itemStyle: { color, opacity: opts.partialLast && labels[i] === `${CURRENT_YEAR}*` ? 0.55 : 1 },
        })),
        label: opts.valueLabels ? { show: true, position: 'top', distance: 3, color: t.ink, fontFamily: t.mono, fontSize: 10.5, formatter: (p: { value: number }) => fmt(Math.round(p.value)) } : undefined,
        emphasis: { itemStyle: { color: t.red } },
      },
    ],
  };
}

/** Single line over years with square markers and a crosshair. */
export function lineYears(t: ChartTokens, years: number[], values: (number | null)[], name: string, format: (n: number) => string = fmt1): EChartsCoreOption {
  return {
    animationDuration: 250,
    grid: { ...grid, top: 10 },
    tooltip: {
      ...tooltipBase(t),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.gray, width: 1 } },
      formatter: (ps: { dataIndex: number; value: number | null }[]) =>
        ps.length ? tipTitle(String(years[ps[0].dataIndex])) + tipRow(t.slate, name, ps[0].value == null ? '–' : format(ps[0].value)) : '',
    },
    xAxis: { type: 'category', data: years.map(String), boundaryGap: false, ...axisBase(t), axisLabel: { ...axisBase(t).axisLabel, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: 'value', splitNumber: 3, ...axisBase(t), axisLine: { show: false } },
    series: [
      {
        name,
        type: 'line',
        data: values,
        symbol: 'rect',
        symbolSize: 6,
        showSymbol: years.length <= 24,
        lineStyle: { width: 2, color: t.slate },
        itemStyle: { color: t.slate, borderColor: t.panel, borderWidth: 1 },
        areaStyle: { color: t.slate, opacity: 0.06 },
      },
    ],
  };
}

export interface NetNode {
  id: string;
  name: string;
  count: number;
}

/** Force-directed co-author network: slate squares, the selected person in red. */
export function network(t: ChartTokens, nodes: NetNode[], links: { source: string; target: string; weight: number }[], focus: string | null): EChartsCoreOption {
  const maxC = Math.max(1, ...nodes.map((n) => n.count));
  const maxW = Math.max(1, ...links.map((l) => l.weight));
  const labelCut = [...nodes].sort((a, b) => b.count - a.count)[Math.min(11, nodes.length - 1)]?.count ?? 0;
  const neighbours = new Set<string>();
  if (focus) for (const l of links) if (l.source === focus || l.target === focus) neighbours.add(l.source === focus ? l.target : l.source);
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));
  return {
    animationDurationUpdate: 300,
    tooltip: {
      ...tooltipBase(t),
      trigger: 'item',
      formatter: (p: { dataType: string; data: { name?: string; value?: number; source?: string; target?: string } }) =>
        p.dataType === 'edge'
          ? tipTitle(`${nameOf.get(p.data.source!)} — ${nameOf.get(p.data.target!)}`) + tipRow(t.slate, 'Gezamenlijke outputs', fmt(p.data.value ?? 0))
          : tipTitle(p.data.name ?? '') + tipRow(t.slate, 'Outputs in selectie', fmt(p.data.value ?? 0)) +
            `<div style="color:${t.ink3};margin-top:4px;font-size:11px">Klik voor profiel</div>`,
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        force: { repulsion: [90, 340], edgeLength: [50, 160], gravity: 0.14, friction: 0.15 },
        scaleLimit: { min: 0.4, max: 4 },
        symbol: 'rect',
        label: {
          show: true,
          position: 'right',
          color: t.ink2,
          fontFamily: t.sans,
          fontSize: 11,
          formatter: (p: { data: { value: number; name: string; id: string } }) =>
            p.data.value >= labelCut || p.data.id === focus || neighbours.has(p.data.id) ? esc(p.data.name) : '',
        },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', label: { show: true, formatter: '{b}', color: t.ink }, lineStyle: { width: 2.5 } },
        blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.05 }, label: { show: false } },
        data: nodes.map((n) => {
          const isFocus = n.id === focus;
          const dim = focus && !isFocus && !neighbours.has(n.id);
          return {
            id: n.id,
            name: n.name,
            value: n.count,
            symbolSize: 7 + Math.sqrt(n.count / maxC) * 22,
            itemStyle: { color: isFocus ? t.red : dim ? t.gray : t.slate, borderColor: t.panel, borderWidth: 1.5 },
            label: isFocus ? { show: true, color: t.ink, fontWeight: 600 } : undefined,
          };
        }),
        links: links.map((l) => ({
          source: l.source,
          target: l.target,
          value: l.weight,
          lineStyle: { color: t.gray, width: 0.5 + (l.weight / maxW) * 3, opacity: 0.35 + (l.weight / maxW) * 0.5, curveness: 0 },
        })),
      },
    ],
  };
}
