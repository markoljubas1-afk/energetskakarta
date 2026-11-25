import { describe, expect, it } from "vitest";

import {
  ALL,
  compareYears,
  PeriodsSchema,
  rangeDays,
  rangeTotals,
  series,
  technologiesOf,
  YearFileSchema,
  type Periods,
  type YearFile,
} from "./energy";

const block = (periods: string[], hydro: (number | null)[], coverage: number[], load: (number | null)[]) => ({
  periods,
  generation: { hydro, solar: periods.map(() => 1) },
  consumption: { pumped_storage: periods.map(() => 0.5) },
  load,
  coverage: { generation: coverage, load: coverage },
});

const PERIODS: Periods = PeriodsSchema.parse({
  version: 1,
  unit: "MWh",
  countries: {
    HR: {
      months: block(["2024-12", "2025-01", "2025-02"], [10, 20, null], [1, 0.5, 0], [30, 40, null]),
      years: block(["2024", "2025"], [10, 20], [1, 0.3], [30, 40]),
    },
    SI: {
      months: block(["2024-12", "2025-01", "2025-02"], [null, 5, 6], [0, 1, 1], [null, 10, 12]),
      years: block(["2024", "2025"], [null, 11], [0, 1], [null, 22]),
    },
  },
});

describe("series", () => {
  it("returns one country as published", () => {
    const hr = series(PERIODS, "HR", "month");
    expect(hr.generation.hydro).toEqual([10, 20, null]);
    expect(hr.coverage).toEqual([1, 0.5, 0]);
    expect(hr.pumping).toEqual([0.5, 0.5, 0.5]);
  });

  it("sums the region, keeps gaps and takes the weakest coverage", () => {
    const all = series(PERIODS, ALL, "month");
    expect(all.countries).toEqual(["HR", "SI"]);
    expect(all.generation.hydro).toEqual([10, 25, 6]);
    expect(all.load).toEqual([30, 50, 12]);
    expect(all.coverage).toEqual([0, 0.5, 0]);
  });

  it("orders technologies by total", () => {
    expect(technologiesOf(series(PERIODS, ALL, "year"))).toEqual(["hydro", "solar"]);
  });

  it("rejects inconsistent data", () => {
    const broken = structuredClone(PERIODS);
    const hr = broken.countries.HR;
    if (!hr) throw new Error("fixture without HR");
    hr.months.load = [1];
    expect(() => series(broken, "HR", "month")).toThrow(/columns do not match/);
    expect(() => series(PERIODS, "AT", "month")).toThrow(/no energy data for AT/);
    const shifted = structuredClone(PERIODS);
    const si = shifted.countries.SI;
    if (!si) throw new Error("fixture without SI");
    si.months.periods = ["2025-01", "2025-02", "2025-03"];
    expect(() => series(shifted, ALL, "month")).toThrow(/different periods/);
  });
});

describe("compareYears", () => {
  it("puts each month in its column and drops years without values", () => {
    const lines = compareYears(series(PERIODS, "HR", "month"), "hydro");
    expect(lines.map((l) => l.year)).toEqual(["2024", "2025"]);
    expect(lines[0]?.values[11]).toBe(10);
    expect(lines[1]?.values.slice(0, 3)).toEqual([20, null, null]);
    expect(lines[1]?.coverage[0]).toBe(0.5);
    expect(compareYears(series(PERIODS, "HR", "month"), "wind")).toEqual([]);
  });
});

function yearFile(): YearFile {
  const days = ["2025-01-01", "2025-01-02", "2025-01-03"];
  return YearFileSchema.parse({
    version: 1,
    year: 2025,
    unit: "MWh",
    days,
    countries: {
      HR: {
        generation: { hydro: [10, 10, null], solar: [1, 2, null] },
        consumption: { pumped_storage: [3, 3, 0] },
        load: [20, 20, null],
        coverage: { generation: [1, 1, 0], load: [1, 1, 0] },
      },
      SI: {
        generation: { hydro: [5, null, 5] },
        consumption: {},
        load: [10, null, 10],
        coverage: { generation: [1, 0, 1], load: [1, 0, 1] },
      },
    },
  });
}

describe("rangeTotals", () => {
  it("sums a fully covered range with shares of load", () => {
    const totals = rangeTotals([yearFile()], "HR", ["HR", "SI"], "2025-01-01", "2025-01-02");
    expect(totals).toMatchObject({ days: 2, coveredDays: 2, total: 23, load: 40, pumping: 6 });
    expect(totals.generation).toEqual([
      { tech: "hydro", mwh: 20 },
      { tech: "solar", mwh: 3 },
    ]);
  });

  it("reports partial coverage and withholds load when it is incomplete", () => {
    const totals = rangeTotals([yearFile()], ALL, ["HR", "SI"], "2025-01-01", "2025-01-03");
    expect(totals.coveredDays).toBe(1); // only 1 January has both countries
    expect(totals.total).toBe(33); // HR 20 + 3, SI 10: reported values count even on partial days
    expect(totals.load).toBeNull();
  });

  it("validates ranges", () => {
    expect(rangeDays("2025-01-01", "2025-01-31")).toBe(31);
    expect(rangeDays("2025-02-01", "2025-01-31")).toBeNull();
    expect(rangeDays("2020-01-01", "2025-01-01")).toBeNull(); // more than three years
    expect(rangeDays("yesterday", "2025-01-01")).toBeNull();
    expect(rangeDays("2026-13-01", "2026-13-02")).toBeNull(); // no 13th month
    expect(rangeDays("2026-02-30", "2026-03-02")).toBeNull(); // Date.parse would roll it into March
    expect(rangeDays("2024-02-29", "2024-03-01")).toBe(2); // a leap day exists
    expect(() => rangeTotals([], "HR", [], "b", "a")).toThrow(/invalid range/);
  });
});
