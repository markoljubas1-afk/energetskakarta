/** Stacked areas for the time bar (Faza 18-3). Pure: drawn in a fixed viewBox, stretched by CSS. */
import type { Technology } from "../domain";

export const CHART_W = 300;
export const CHART_H = 56;

/** A round top for the axis: 1, 2 or 5 times a power of ten, at or above the largest total. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((k) => k * power >= value) ?? 10;
  return step * power;
}

export interface Area {
  technology: Technology;
  d: string;
}

/** Areas stacked in the given order, bottom first; x runs over the years, y over MW up to `max`. */
export function stackAreas(rows: readonly { technology: Technology; mw: readonly number[] }[]): {
  areas: Area[];
  max: number;
} {
  const n = Math.max(0, ...rows.map((row) => row.mw.length));
  const totals = Array.from({ length: n }, (_, i) => rows.reduce((sum, row) => sum + (row.mw[i] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const x = (i: number): string => (n <= 1 ? CHART_W / 2 : (i / (n - 1)) * CHART_W).toFixed(1);
  const y = (v: number): string => (CHART_H - (v / max) * CHART_H).toFixed(1);
  let base = new Array<number>(n).fill(0);
  const areas = rows.map((row) => {
    const top = base.map((b, i) => b + (row.mw[i] ?? 0));
    const upper = top.map((v, i) => `${x(i)},${y(v)}`).join("L");
    const lower = base
      .map((v, i) => `${x(i)},${y(v)}`)
      .reverse()
      .join("L");
    base = top;
    return { technology: row.technology, d: `M${upper}L${lower}Z` };
  });
  return { areas, max };
}

/** Where a year sits on the chart's x axis. */
export const yearX = (year: number, first: number, last: number): number =>
  last <= first ? CHART_W / 2 : ((year - first) / (last - first)) * CHART_W;

/**
 * How long one year stays on screen while playing: quiet early decades pass quickly, recent ones (where
 * most plants were built) slowly enough to see them appear.
 */
export const stepMs = (year: number): number => (year < 1950 ? 90 : year < 2000 ? 200 : 380);
