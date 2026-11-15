import { describe, expect, it } from "vitest";

import { dashPattern, FLOW_DASH, FLOW_STEPS, stepAt, stepPattern } from "./flowAnimation";

const period = FLOW_DASH.dash + FLOW_DASH.gap;
const sum = (pattern: readonly number[]): number => pattern.reduce((a, b) => a + b, 0);

/** Where the dash covers the line within one period, as [start, end) intervals. */
function coverage(pattern: readonly [number, number, number, number]): [number, number][] {
  const [d1, g1, d2] = pattern;
  const result: [number, number][] = [];
  if (d1 > 0) result.push([0, d1]);
  if (d2 > 0) result.push([d1 + g1, d1 + g1 + d2]);
  return result;
}

describe("dashPattern", () => {
  it("keeps the period, so the pattern repeats seamlessly at every offset", () => {
    for (let offset = 0; offset < period; offset += 0.05) {
      expect(sum(dashPattern(offset))).toBeCloseTo(period, 3);
      expect(dashPattern(offset).every((part) => part >= 0)).toBe(true);
    }
  });

  it("starts the dash exactly at the offset and wraps its tail to the front of the period", () => {
    expect(dashPattern(0)).toEqual([0, 0, FLOW_DASH.dash, FLOW_DASH.gap]);
    expect(coverage(dashPattern(1))).toEqual([[1, 1 + FLOW_DASH.dash]]);
    // past the gap the dash crosses the period boundary: tail first, head last
    const wrapped = coverage(dashPattern(period - 0.5));
    expect(wrapped.flat().map((v) => Math.round(v * 1000) / 1000)).toEqual(
      [0, FLOW_DASH.dash - 0.5, period - 0.5, period].map((v) => Math.round(v * 1000) / 1000),
    );
  });

  it("treats a full period as no shift at all", () => {
    expect(coverage(dashPattern(period))).toEqual(coverage(dashPattern(0)));
    expect(coverage(dashPattern(-0.3))).toEqual(coverage(dashPattern(period - 0.3)));
  });
});

/** Where the dash begins inside the period, whichever of the two pattern shapes is used. */
const head = ([d1, g1, , g2]: readonly [number, number, number, number]): number =>
  g2 === 0 && d1 > 0 ? d1 + g1 : g1;

describe("stepPattern", () => {
  it("moves the dash forward on every step and comes back to the start after a cycle", () => {
    const starts = Array.from({ length: FLOW_STEPS }, (_, step) => head(stepPattern(step)));
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1] ?? Infinity);
    expect(starts[0]).toBe(0);
    expect(stepPattern(FLOW_STEPS)).toEqual(stepPattern(0));
  });
});

describe("stepAt", () => {
  it("is monotone within a cycle and never returns a frame outside the range", () => {
    let previous = -1;
    for (let t = 0; t < 1100; t += 10) {
      const step = stepAt(t, 0, FLOW_STEPS, 1100);
      expect(step).toBeGreaterThanOrEqual(previous);
      expect(step).toBeLessThan(FLOW_STEPS);
      previous = step;
    }
    expect(stepAt(1100, 0, FLOW_STEPS, 1100)).toBe(0);
    // a clock that runs behind the start (a paused tab) still yields a valid frame
    expect(stepAt(-5, 0, FLOW_STEPS, 1100)).toBeLessThan(FLOW_STEPS);
  });
});
