import { describe, expect, it } from "vitest";

import { polyline, sparkline } from "./sparkline";

const BOX = { width: 100, height: 40, padY: 5 };

describe("sparkline", () => {
  it("scales between the smallest and largest reported value and breaks the line at a gap", () => {
    const chart = sparkline([10, 20, null, 30, 30], BOX);
    expect(chart.points.map((p) => p.index)).toEqual([0, 1, 3, 4]);
    expect(chart.runs.map((run) => run.length)).toEqual([2, 2]);
    expect(chart.gaps).toEqual([50]);
    // the largest value is at the top of the usable band, the smallest at the bottom
    expect(chart.max).toMatchObject({ index: 3, y: 5 });
    expect(chart.min).toMatchObject({ index: 0, y: 35 });
    expect(chart.points[1]?.y).toBe(20);
    expect(polyline(chart.runs[0] ?? [])).toBe("4,35 27,20");
  });

  it("puts a flat series in the middle and copes with nothing at all", () => {
    const flat = sparkline([5, 5, 5], BOX);
    expect(new Set(flat.points.map((p) => p.y))).toEqual(new Set([20]));
    const empty = sparkline([null, null], BOX);
    expect(empty.points).toEqual([]);
    expect(empty.gaps).toEqual([4, 96]);
    expect(empty.min).toBeNull();
  });
});
