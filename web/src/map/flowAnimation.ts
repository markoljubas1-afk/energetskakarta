/**
 * Moving dashes along the live flow arcs, so the direction of a flow is visible without reading the
 * arrowhead. MapLibre cannot offset a dash pattern, but a pattern can be rewritten every frame: each step
 * is the same dash shifted a little further along the line (a MapLibre-documented technique).
 *
 * Patterns are in units of line width. Arcs run from the exporting to the importing country
 * (data/live.ts), so a growing offset moves the dashes with the electricity.
 */

/** Dash and gap lengths of the travelling pattern, in line widths. */
export const FLOW_DASH = { dash: 1.6, gap: 2.8 } as const;
/** Distinct frames per cycle; more looks smoother, each one is a paint-property update. */
export const FLOW_STEPS = 28;
/** Time for a dash to travel one period. */
export const FLOW_CYCLE_MS = 1100;

export type DashPattern = readonly [number, number, number, number];

const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * The pattern whose first dash starts `offset` line widths into the period. A dash that would cross the
 * end of the period is split: its tail comes first, so the pattern still repeats seamlessly.
 */
export function dashPattern(offset: number, { dash, gap } = FLOW_DASH): DashPattern {
  const period = dash + gap;
  const at = ((offset % period) + period) % period;
  if (at <= gap) return [0, round(at), dash, round(gap - at)];
  return [round(at - gap), gap, round(period - at), 0];
}

/** Frame `step` of `steps` per cycle. */
export function stepPattern(step: number, steps = FLOW_STEPS): DashPattern {
  const period = FLOW_DASH.dash + FLOW_DASH.gap;
  return dashPattern(((step % steps) / steps) * period);
}

/** Which frame is due at time `now` (ms), given when the animation started. */
export function stepAt(now: number, startedAt: number, steps = FLOW_STEPS, cycleMs = FLOW_CYCLE_MS): number {
  const phase = (((now - startedAt) % cycleMs) + cycleMs) % cycleMs;
  return Math.floor((phase / cycleMs) * steps) % steps;
}
