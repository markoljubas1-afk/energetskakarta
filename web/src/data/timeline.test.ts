import { describe, expect, it } from "vitest";

import { TECHNOLOGIES, type CountryCode, type Technology } from "../domain";
import { SAMPLE_TIMELINE } from "./timeline.fixture";
import { clampYear, retiredFeatures, stackedSeries, summarize, type TimelineScope } from "./timeline";

const scope = (
  countries: CountryCode[] = [],
  technologies: readonly Technology[] = TECHNOLOGIES,
): TimelineScope => ({
  countries: new Set(countries),
  technologies: new Set(technologies),
});

describe("timeline", () => {
  it("stacks technologies in canonical order over the chosen countries", () => {
    const rows = stackedSeries(SAMPLE_TIMELINE, scope());
    expect(rows.map((r) => r.technology)).toEqual(TECHNOLOGIES.filter((t) => t === "hydro" || t === "coal"));
    expect(rows.find((r) => r.technology === "hydro")?.mw).toEqual([50, 626, 626, 626, 626]);
    expect(stackedSeries(SAMPLE_TIMELINE, scope(["SI"])).map((r) => r.technology)).toEqual(["hydro"]);
    expect(stackedSeries(SAMPLE_TIMELINE, scope([], ["wind"]))).toEqual([]);
  });

  it("sums a year and tells what has closed by then", () => {
    const running = summarize(SAMPLE_TIMELINE, scope(), 1963);
    expect(running).toMatchObject({ operatingMw: 751, closedPlants: 0, lastClosure: null, undatedPlants: 4 });
    const closed = summarize(SAMPLE_TIMELINE, scope(["HR"]), 1964);
    expect(closed).toMatchObject({ operatingMw: 576, closedPlants: 1, closedMw: 125, undatedPlants: 3 });
    expect(closed.lastClosure?.name).toBe("TE Plomin 1");
  });

  it("draws a retired plant as running, then as an outline, and not before it was built", () => {
    const phase = (year: number) =>
      retiredFeatures(SAMPLE_TIMELINE, scope(), year).features.map((f): unknown => f.properties?.phase);
    expect(phase(1961)).toEqual([]);
    expect(phase(1962)).toEqual(["running"]);
    expect(phase(1964)).toEqual(["closed"]);
    // the map's technology filter applies to outlines too
    expect(retiredFeatures(SAMPLE_TIMELINE, scope([], ["hydro"]), 1964).features).toEqual([]);
  });

  it("keeps a year inside the timeline", () => {
    expect(clampYear(SAMPLE_TIMELINE, 1900)).toBe(1960);
    expect(clampYear(SAMPLE_TIMELINE, 2026)).toBe(1964);
    expect(clampYear(SAMPLE_TIMELINE, 1962.4)).toBe(1962);
  });
});
