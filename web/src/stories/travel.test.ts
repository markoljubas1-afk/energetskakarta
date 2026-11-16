import { describe, expect, it } from "vitest";

import { eased, measure, travellerAt, type Position } from "./travel";

// on the equator, so a degree east is as long as a degree north: 1 east, then 1 north, then 2 east
const POINTS: Position[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [3, 1],
];

describe("a point of light on a route", () => {
  const route = measure(POINTS);

  it("measures the way point by point", () => {
    expect(route.along.map((d) => Math.round(d * 1000) / 1000)).toEqual([0, 1, 2, 4]);
  });

  it("starts at the start and ends at the end, with the whole way behind it", () => {
    expect(travellerAt(route, 0)).toEqual({ head: [0, 0], trail: [[0, 0]] });
    expect(travellerAt(route, 1)).toEqual({ head: [3, 1], trail: POINTS });
    expect(travellerAt(route, -3)).toEqual(travellerAt(route, 0));
    expect(travellerAt(route, 7)).toEqual(travellerAt(route, 1));
  });

  it("is between two points in proportion to the way covered, and its trail ends where it is", () => {
    const half = travellerAt(route, 0.5);
    expect(half?.head[0]).toBeCloseTo(1, 3);
    expect(half?.head[1]).toBeCloseTo(1, 3);
    const later = travellerAt(route, 0.75);
    expect(later?.head[0]).toBeCloseTo(2, 3);
    expect(later?.head[1]).toBeCloseTo(1, 3);
    expect(later?.trail.slice(0, 3)).toEqual(POINTS.slice(0, 3));
    expect(later?.trail.at(-1)).toEqual(later?.head);
    const early = travellerAt(route, 0.125);
    expect(early?.head[0]).toBeCloseTo(0.5, 3);
    expect(early?.trail).toHaveLength(2);
  });

  it("has nothing to show for an empty route, and stays put on a route of one place", () => {
    expect(travellerAt(measure([]), 0.5)).toBeNull();
    expect(travellerAt(measure([[5, 5]]), 0.5)).toEqual({ head: [5, 5], trail: [[5, 5]] });
  });

  it("leaves and arrives gently", () => {
    expect(eased(0)).toBe(0);
    expect(eased(1)).toBe(1);
    expect(eased(0.5)).toBeCloseTo(0.5, 6);
    expect(eased(0.1)).toBeLessThan(0.1);
    expect(eased(0.9)).toBeGreaterThan(0.9);
    expect(eased(2)).toBe(1);
  });
});
