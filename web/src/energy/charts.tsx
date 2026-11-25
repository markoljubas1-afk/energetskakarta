/**
 * Chart.js behind two small components. Only this module imports Chart.js, so it arrives with the energy
 * view and component tests can replace it.
 */
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type TooltipItem,
} from "chart.js";
import { useEffect, useRef } from "react";

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

export interface BarSeries {
  label: string;
  color: string;
  values: (number | null)[];
}

interface Common {
  labels: string[];
  /** accessible summary of what the chart shows */
  description: string;
  /** formats a value in the chart's unit for axes and tooltips */
  format: (value: number) => string;
  ink: string;
  grid: string;
}

export interface StackedProps extends Common {
  bars: BarSeries[];
  /** a line over the bars (total consumption); left out when the bars say it all */
  line?: BarSeries;
  /** 0–1 per label; incomplete periods are drawn lighter */
  coverage: number[];
  /** extra tooltip line for a label index (e.g. "data for 19 of 31 days") */
  note: (index: number) => string | null;
  /** the top of the value axis, when it is known (100 for shares that add up to 100 %) */
  max?: number;
}

function useChart(config: () => ChartConfiguration, deps: unknown[]) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const chart = new Chart(canvas.current, config());
    return () => {
      chart.destroy();
    };
    // the config factory is rebuilt from `deps`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return canvas;
}

function alpha(hex: string, value: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${value})`;
}

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function StackedChart(props: StackedProps) {
  const { labels, bars, line, coverage, note, description, format, ink, grid, max } = props;
  const canvas = useChart(
    () => ({
      type: "bar",
      data: {
        labels,
        datasets: [
          ...bars.map((bar) => ({
            type: "bar" as const,
            label: bar.label,
            data: bar.values,
            stack: "generation",
            // incomplete periods are paler, so a short bar is never mistaken for low generation
            backgroundColor: coverage.map((c) => alpha(bar.color, c >= 1 ? 0.88 : 0.35)),
            borderColor: bar.color,
            borderWidth: coverage.map((c) => (c >= 1 ? 0 : 1)),
          })),
          ...(line
            ? [
                {
                  type: "line" as const,
                  label: line.label,
                  data: line.values,
                  borderColor: line.color,
                  backgroundColor: line.color,
                  borderWidth: 2,
                  pointRadius: coverage.map((c) => (c >= 1 ? 2 : 4)),
                  // incomplete periods: hollow point, dashed segments, like the paler bars
                  pointBackgroundColor: coverage.map((c) => (c >= 1 ? line.color : "rgba(0,0,0,0)")),
                  segment: {
                    borderDash: (ctx: { p0DataIndex: number; p1DataIndex: number }) =>
                      (coverage[ctx.p0DataIndex] ?? 0) < 1 || (coverage[ctx.p1DataIndex] ?? 0) < 1
                        ? [5, 4]
                        : undefined,
                  },
                  spanGaps: false,
                  tension: 0.25,
                },
              ]
            : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 300 },
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: ink, maxRotation: 0, autoSkipPadding: 8 },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ...(max === undefined ? {} : { max }),
            grid: { color: grid },
            ticks: { color: ink, callback: (value) => format(Number(value)) },
          },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: ink, usePointStyle: true, boxWidth: 8, boxHeight: 8 },
          },
          tooltip: {
            callbacks: {
              label: (item: TooltipItem<"bar" | "line">) =>
                item.parsed.y === null
                  ? `${item.dataset.label ?? ""}: —`
                  : `${item.dataset.label ?? ""}: ${format(item.parsed.y)}`,
              footer: (items: TooltipItem<"bar" | "line">[]) => note(items[0]?.dataIndex ?? 0) ?? "",
            },
          },
        },
      },
    }),
    [labels, bars, line, coverage, note, format, ink, grid, max],
  );
  return <canvas ref={canvas} role="img" aria-label={description} />;
}

export interface LinesProps extends Common {
  lines: BarSeries[];
}

export function LinesChart({ labels, lines, description, format, ink, grid }: LinesProps) {
  const canvas = useChart(
    () => ({
      type: "line",
      data: {
        labels,
        datasets: lines.map((line) => ({
          label: line.label,
          data: line.values,
          borderColor: line.color,
          backgroundColor: line.color,
          borderWidth: 2,
          pointRadius: 3,
          spanGaps: false,
          tension: 0.25,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 300 },
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { color: ink } },
          y: {
            beginAtZero: true,
            grid: { color: grid },
            ticks: { color: ink, callback: (value) => format(Number(value)) },
          },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: ink, usePointStyle: true, boxWidth: 8, boxHeight: 8 },
          },
          tooltip: {
            callbacks: {
              label: (item: TooltipItem<"line">) =>
                item.parsed.y === null
                  ? `${item.dataset.label ?? ""}: —`
                  : `${item.dataset.label ?? ""}: ${format(item.parsed.y)}`,
            },
          },
        },
      },
    }),
    [labels, lines, format, ink, grid],
  );
  return <canvas ref={canvas} role="img" aria-label={description} />;
}
