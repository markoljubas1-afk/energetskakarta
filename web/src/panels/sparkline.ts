/**
 * Geometry for a small line chart of daily values: pure functions, so the shape is tested without a DOM.
 *
 * The vertical scale runs from the smallest to the largest reported value, not from zero: the point of
 * the chart is the day-to-day difference, which a zero-based scale of 14 nearly equal days would hide.
 * The axis therefore says both ends out loud (min and max are labelled), so the reader is never misled.
 */

export interface SparkPoint {
  index: number;
  x: number;
  y: number;
  value: number;
}

export interface Sparkline {
  /** consecutive reported days, one polyline each; a missing day breaks the line */
  runs: SparkPoint[][];
  /** the reported points, in order */
  points: SparkPoint[];
  /** x positions of days with no figure */
  gaps: number[];
  min: SparkPoint | null;
  max: SparkPoint | null;
}

export interface SparkBox {
  width: number;
  height: number;
  /** room left above and below the line for the min/max dots */
  padY: number;
}

export function sparkline(values: readonly (number | null)[], box: SparkBox): Sparkline {
  const reported = values.flatMap((value, index) => (value === null ? [] : [{ index, value }]));
  if (reported.length === 0) {
    return {
      runs: [],
      points: [],
      gaps: values.map((_, i) => xOf(i, values.length, box)),
      min: null,
      max: null,
    };
  }
  const lo = Math.min(...reported.map((p) => p.value));
  const hi = Math.max(...reported.map((p) => p.value));
  const span = hi - lo;
  const yOf = (value: number): number => {
    const usable = box.height - 2 * box.padY;
    // a flat series sits in the middle instead of dividing by zero
    const share = span === 0 ? 0.5 : (value - lo) / span;
    return round(box.padY + usable * (1 - share));
  };
  const points: SparkPoint[] = reported.map(({ index, value }) => ({
    index,
    value,
    x: xOf(index, values.length, box),
    y: yOf(value),
  }));
  const runs: SparkPoint[][] = [];
  for (const point of points) {
    const current = runs[runs.length - 1];
    if (current && current[current.length - 1]?.index === point.index - 1) current.push(point);
    else runs.push([point]);
  }
  const gaps = values.flatMap((value, index) => (value === null ? [xOf(index, values.length, box)] : []));
  // the first occurrence of each extreme, so a plateau is labelled once
  const min = points.find((p) => p.value === lo) ?? null;
  const max = points.find((p) => p.value === hi) ?? null;
  return { runs, points, gaps, min, max };
}

function xOf(index: number, count: number, box: SparkBox): number {
  if (count <= 1) return round(box.width / 2);
  const inset = 4;
  return round(inset + ((box.width - 2 * inset) * index) / (count - 1));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function polyline(run: readonly SparkPoint[]): string {
  return run.map((p) => `${p.x},${p.y}`).join(" ");
}
