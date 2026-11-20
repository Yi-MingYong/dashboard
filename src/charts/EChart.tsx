import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, GraphChart, HeatmapChart, LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  BarChart, LineChart, HeatmapChart, GraphChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, AriaComponent,
  CanvasRenderer,
]);

export type ChartClick = (params: { componentType?: string; dataType?: string; name?: string; dataIndex?: number; seriesName?: string; data?: unknown }) => void;

interface Props {
  option: EChartsCoreOption;
  height: number | string;
  label: string;
  onClick?: ChartClick;
}

export function EChart({ option, height, label, onClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef<ChartClick | undefined>(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current) return;
    const inst = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = inst;
    inst.on('click', (p) => clickRef.current?.(p as Parameters<ChartClick>[0]));
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      inst.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return <div ref={el} className="chart" style={{ height }} role="img" aria-label={label} />;
}
