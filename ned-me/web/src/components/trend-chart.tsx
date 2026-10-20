'use client';
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);

export interface TrendPoint { period: string; actual?: number; target?: number }

/** Courbe réalisé / cible. Les couleurs viennent des jetons de la page (clair et sombre) ; les couleurs de statut ne servent jamais à une série. Le tableau des valeurs reste l'alternative accessible. */
export function TrendChart({ points, labels, ariaLabel, locale }: { points: TrendPoint[]; labels: { actual: string; target: string }; ariaLabel: string; locale: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'svg' });
    const draw = () => {
      const css = getComputedStyle(document.documentElement);
      const v = (n: string) => css.getPropertyValue(n).trim();
      const fmt = new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale);
      const rtl = document.documentElement.dir === 'rtl';
      chart.setOption({
        animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        textStyle: { color: v('--muted-foreground'), fontFamily: 'inherit' },
        color: [v('--primary'), v('--muted-foreground')],
        grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
        legend: { top: 0, textStyle: { color: v('--foreground') }, [rtl ? 'right' : 'left']: 0 },
        tooltip: { trigger: 'axis', confine: true, backgroundColor: v('--card'), borderColor: v('--border'), textStyle: { color: v('--foreground') }, valueFormatter: (x: number) => fmt.format(x) },
        xAxis: { type: 'category', data: points.map((p) => p.period), inverse: rtl, axisLine: { lineStyle: { color: v('--border') } }, axisLabel: { color: v('--muted-foreground') } },
        yAxis: { type: 'value', position: rtl ? 'right' : 'left', splitLine: { lineStyle: { color: v('--border') } }, axisLabel: { color: v('--muted-foreground'), formatter: (x: number) => fmt.format(x) } },
        series: [
          { name: labels.actual, type: 'line', data: points.map((p) => p.actual ?? null), symbolSize: 8, lineStyle: { width: 3 }, connectNulls: false },
          { name: labels.target, type: 'line', data: points.map((p) => p.target ?? null), symbol: 'none', lineStyle: { width: 2, type: 'dashed' }, connectNulls: true },
        ],
      }, true);
    };
    draw();
    const ro = new ResizeObserver(() => chart.resize()); ro.observe(el);
    const mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', draw);
    return () => { mq.removeEventListener('change', draw); ro.disconnect(); chart.dispose(); };
  }, [points, labels, locale]);
  return <div ref={ref} role="img" aria-label={ariaLabel} className="h-64 w-full" data-testid="trend-chart" />;
}
