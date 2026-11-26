import { describe, expect, it } from "vitest";

import { CHART_H, CHART_W, niceMax, stackAreas, stepMs, yearTicks, yearX, yTicks } from "./timeChart";

describe("time chart", () => {
  it("rounds the axis top to 1, 2 or 5 times a power of ten", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(751)).toBe(1000);
    expect(niceMax(1200)).toBe(2000);
    expect(niceMax(4945)).toBe(5000);
    expect(niceMax(5000)).toBe(5000);
  });

  it("stacks areas bottom first and closes each one", () => {
    const { areas, max } = stackAreas([
      { technology: "hydro", mw: [0, 500] },
      { technology: "wind", mw: [0, 500] },
    ]);
    expect(max).toBe(1000);
    expect(areas[0]?.d).toBe(
      `M0.0,${CHART_H.toFixed(1)}L${CHART_W.toFixed(1)},28.0L${CHART_W.toFixed(1)},56.0L0.0,56.0Z`,
    );
    expect(areas[1]?.d.startsWith("M0.0,56.0L300.0,0.0")).toBe(true);
  });

  it("puts a single year in the middle and years across the width", () => {
    expect(yearX(1964, 1964, 1964)).toBe(CHART_W / 2);
    expect(yearX(1962, 1960, 1964)).toBe(CHART_W / 2);
    expect(stackAreas([{ technology: "solar", mw: [10] }]).areas[0]?.d).toContain("150.0");
  });

  it("spends longer on recent years while playing", () => {
    expect(stepMs(1920)).toBeLessThan(stepMs(1970));
    expect(stepMs(1970)).toBeLessThan(stepMs(2020));
  });
});

describe("the chart's axes (D3)", () => {
  it("draws a line at half the top and at the top, both round since the top is", () => {
    expect(yTicks(200_000)).toEqual([100_000, 200_000]);
    expect(yTicks(5000)).toEqual([2500, 5000]);
    expect(yTicks(1000)).toEqual([500, 1000]);
  });

  it("names round years between the ends, none so close to an end that the labels would touch", () => {
    // 1888 to 2026: every fifty years; 1900 is far enough from 1888 to be read on its own
    expect(yearTicks(1888, 2026)).toEqual([1900, 1950, 2000]);
    expect(yearTicks(1960, 2026)).toEqual([1975, 2000]);
    expect(yearTicks(2000, 2026)).toEqual([2010, 2020]);
    expect(yearTicks(2020, 2026)).toEqual([]);
  });
});
