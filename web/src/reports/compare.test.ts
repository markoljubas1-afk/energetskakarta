import { describe, expect, it } from "vitest";

import { ALL, type Periods } from "../data/energy";
import type { PriceMonths } from "../data/priceMonths";
import { parseState, serializeState } from "../state/url";
import { compareLink } from "../seo/report";
import {
  areaRows,
  change,
  countriesSide,
  countryPeriods,
  krskoOfRows,
  krskoOverMonths,
  latestUsable,
  monthAcrossYears,
  resolveChoice,
  sameChoice,
  yearAgainstYear,
  yearsOf,
} from "./compare";
import { monthSpan } from "./CompareView";

/** Months of 2024 and of 2025 up to March. */
const MONTHS = [
  ...Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}`),
  "2025-01",
  "2025-02",
  "2025-03",
];

interface Spec {
  hydro: number;
  gas: number;
  /** coverage per month; 1 unless given */
  coverage?: Record<string, number>;
  /** months with no figures at all */
  missing?: string[];
}

function country(spec: Spec): Periods["countries"][string] {
  const value = (amount: number) => MONTHS.map((month) => (spec.missing?.includes(month) ? null : amount));
  const coverage = MONTHS.map((month) => (spec.missing?.includes(month) ? 0 : (spec.coverage?.[month] ?? 1)));
  const block = (periods: string[], hydro: (number | null)[], gas: (number | null)[], cov: number[]) => ({
    periods,
    generation: { hydro, gas },
    consumption: {},
    load: periods.map(() => null),
    coverage: { generation: cov, load: cov },
  });
  return {
    months: block(MONTHS, value(spec.hydro), value(spec.gas), coverage),
    years: block(
      ["2024", "2025"],
      [spec.hydro * 12, spec.hydro * 3],
      [spec.gas * 12, spec.gas * 3],
      [1, 0.25],
    ),
  };
}

const PERIODS: Periods = {
  version: 1,
  unit: "MWh",
  countries: {
    // Croatia: 1000 MWh of hydro and 500 of gas every month, February 2024 reported in part
    HR: country({ hydro: 1000, gas: 500, coverage: { "2024-02": 0.6 } }),
    // Slovenia: more gas than hydro, nothing for March 2025
    SI: country({ hydro: 200, gas: 800, missing: ["2025-03"] }),
  },
};

const PRICES: PriceMonths = {
  version: 1,
  generatedAt: "2025-04-01T00:00:00Z",
  source: "ENTSO-E Transparency Platform",
  timezone: "Europe/Zagreb",
  zones: {
    HR: {
      zone: "10YHR-HEP------M",
      months: {
        "2025-02": {
          hours: 672,
          reported: 672,
          freeHours: 0,
          freeDays: 0,
          min: 10,
          minAt: "2025-02-02T03:00:00+01:00",
          average: 120.5,
        },
        // a month with hours missing has no average to show
        "2025-03": {
          hours: 743,
          reported: 700,
          freeHours: 0,
          freeDays: 0,
          min: 5,
          minAt: "2025-03-02T03:00:00+01:00",
          average: 99,
        },
      },
    },
  },
};

const hr = areaRows(PERIODS, "HR", "month") ?? [];

describe("one month across the years", () => {
  it("is that month of every year, a month reported in part marked by its row", () => {
    const february = monthAcrossYears(hr, 2);
    expect(february.map((row) => [row.period, row.complete, row.total])).toEqual([
      ["2024-02", false, 1500],
      ["2025-02", true, 1500],
    ]);
    expect(february[1]?.share).toBeCloseTo(1000 / 1500);
    // a month no year has yet
    expect(monthAcrossYears(hr, 4).map((row) => row.period)).toEqual(["2024-04"]);
  });

  it("leaves out a year with no figures for the month", () => {
    const si = areaRows(PERIODS, "SI", "month") ?? [];
    expect(monthAcrossYears(si, 3).map((row) => row.period)).toEqual(["2024-03"]);
    expect(latestUsable(si)).toBe("2025-02");
    expect(latestUsable(hr)).toBe("2025-03");
  });

  it("sums the region, as complete as its least complete country", () => {
    const region = areaRows(PERIODS, ALL, "month") ?? [];
    const march = monthAcrossYears(region, 3);
    expect(march.map((row) => [row.period, row.total, row.complete])).toEqual([
      ["2024-03", 2500, true],
      // Slovenia reported nothing: the sum is Croatia's alone and is not a complete month
      ["2025-03", 1500, false],
    ]);
    expect(areaRows(PERIODS, "RS", "month")).toBeNull();
  });
});

describe("one year against another", () => {
  it("compares a year under way with the same months of the other, never with all of it", () => {
    const pair = yearAgainstYear(hr, "2024", "2025");
    if (!pair) throw new Error("a pair");
    // February 2024 was reported in part: February is left out of both years
    expect(pair.months).toEqual([1, 3]);
    expect(pair.rows).toEqual([
      { tech: "hydro", a: 2000, b: 2000 },
      { tech: "gas", a: 1000, b: 1000 },
    ]);
    expect(pair.total).toEqual({ a: 3000, b: 3000 });
    expect(pair.renewable).toEqual({ a: 2000, b: 2000 });
    expect(yearsOf(hr)).toEqual(["2025", "2024"]);
  });

  it("has nothing to say about years without a common complete month", () => {
    expect(yearAgainstYear(hr, "2024", "2031")).toBeNull();
    expect(change(100, 112)).toBeCloseTo(0.12);
    expect(change(0, 5)).toBeNull();
  });
});

describe("Croatia's half of Krško beside the comparisons", () => {
  // Slovenia's nuclear: 500 GWh a month; it reported nothing for March 2025
  const withNuclear = structuredClone(PERIODS);
  const si = withNuclear.countries.SI;
  if (!si) throw new Error("fixture without SI");
  si.months.generation.nuclear = MONTHS.map((month) => (month === "2025-03" ? null : 500_000));

  it("is half of Slovenia's nuclear in each period, and nothing for a period not reported in full", () => {
    const rows = areaRows(withNuclear, "HR", "month") ?? [];
    const halves = krskoOfRows(withNuclear, rows, "month");
    expect(halves[0]).toBe(250_000);
    expect(halves.at(-1)).toBeNull();
    // without Slovenia's nuclear at all there is no figure anywhere
    expect(krskoOfRows(PERIODS, rows, "month").every((value) => value === null)).toBe(true);
  });

  it("adds up over the same months the year comparison uses, or gives nothing", () => {
    expect(krskoOverMonths(withNuclear, "2024", [1, 2, 3])).toBe(750_000);
    expect(krskoOverMonths(withNuclear, "2025", [1, 2, 3])).toBeNull();
    expect(krskoOverMonths(withNuclear, "2025", [])).toBeNull();
  });
});

describe("the countries side by side", () => {
  it("shows the countries reported in full, the greenest first, with the month's price where there is one", () => {
    const rows = countriesSide(PERIODS, "month", "2025-02", PRICES);
    expect(rows.map((each) => [each.code, each.price])).toEqual([
      ["HR", 120.5],
      ["SI", null],
    ]);
    // Croatia: (1000 × 24 + 500 × 490) / 1500 g/kWh
    expect(rows[0]?.intensity).toBeCloseTo((1000 * 24 + 500 * 490) / 1500);
  });

  it("leaves out a country without complete figures, and a price with hours missing", () => {
    expect(countriesSide(PERIODS, "month", "2025-03", PRICES).map((each) => [each.code, each.price])).toEqual(
      [["HR", null]],
    );
    // no year is offered with only one country complete, nor a month with one
    expect(countryPeriods(PERIODS, "month")).not.toContain("2025-03");
    expect(countryPeriods(PERIODS, "month")).not.toContain("2024-02");
    expect(countryPeriods(PERIODS, "month")[0]).toBe("2025-02");
    expect(countryPeriods(PERIODS, "year")).toEqual(["2024"]);
    // a yearly comparison has no price
    expect(countriesSide(PERIODS, "year", "2024", PRICES).every((each) => each.price === null)).toBe(true);
  });
});

describe("what the page shows", () => {
  it("is the visitor's choice when the data has it, else the latest", () => {
    const options = countryPeriods(PERIODS, "month");
    const latest = resolveChoice({ month: null, years: null, period: null }, hr, options);
    expect(latest).toEqual({ month: 3, years: ["2024", "2025"], period: "2025-02" });
    const kept = { month: 7, years: ["2025", "2024"] as const, period: "2024-05" };
    expect(resolveChoice(kept, hr, options)).toEqual(kept);
    // a year or a period the data does not have gives way to the latest
    expect(resolveChoice({ month: 7, years: ["2019", "2024"], period: "2019-01" }, hr, options)).toEqual({
      month: 7,
      years: ["2024", "2025"],
      period: "2025-02",
    });
    expect(sameChoice(latest, { month: 3, years: ["2024", "2025"], period: "2025-02" })).toBe(true);
    expect(sameChoice(latest, { ...latest, years: ["2025", "2024"] })).toBe(false);
  });
});

describe("the months compared, in words", () => {
  const names = [
    "siječanj",
    "veljača",
    "ožujak",
    "travanj",
    "svibanj",
    "lipanj",
    "srpanj",
    "kolovoz",
    "rujan",
    "listopad",
    "studeni",
    "prosinac",
  ];
  it("is a span, a list, or nothing for the whole year", () => {
    expect(monthSpan([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], names, "i")).toEqual({
      kind: "span",
      text: "siječanj–listopad",
    });
    expect(monthSpan([1, 3], names, "i")).toEqual({ kind: "list", text: "siječanj i ožujak" });
    expect(monthSpan([1, 3, 6], names, "i")).toEqual({ kind: "list", text: "siječanj, ožujak i lipanj" });
    expect(monthSpan([5], names, "i")).toEqual({ kind: "span", text: "svibanj" });
    expect(monthSpan([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], names, "i")).toEqual({ kind: "all", text: "" });
    // one month left out of eleven: the sentence names that one
    expect(monthSpan([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12], names, "i")).toEqual({
      kind: "but",
      text: "ožujak",
    });
    expect(monthSpan([1, 2, 4, 5, 6, 7, 8, 9, 10, 12], names, "i")).toEqual({
      kind: "but",
      text: "ožujak i studeni",
    });
  });
});

describe("a comparison as a link", () => {
  it("keeps every choice, and drops what it cannot read", () => {
    const state = parseState("?p=compare&ca=SI&cm=10&cy=2024,2025&cu=year&cp=2024", "hr");
    expect(state.page).toBe("compare");
    expect(state.compare).toEqual({
      area: "SI",
      month: 10,
      years: ["2024", "2025"],
      unit: "year",
      period: "2024",
    });
    expect(serializeState(state, "hr")).toBe("?p=compare&ca=SI&cm=10&cy=2024%2C2025&cu=year&cp=2024");
    const bad = parseState("?p=compare&ca=XX&cm=13&cy=2024,2024&cp=2024-10&cu=year", "hr");
    expect(bad.compare).toEqual({ area: "HR", month: null, years: null, unit: "year", period: null });
    expect(serializeState(parseState("?p=compare", "hr"), "hr")).toBe("?p=compare");
  });

  it("is where the reports send their readers", () => {
    expect(compareLink("hr", null)).toBe("/?p=compare");
    expect(compareLink("en", "2026-10")).toBe("/en/?p=compare&cm=10&cp=2026-10");
    expect(parseState("?p=compare&cm=10&cp=2026-10", "hr").compare).toMatchObject({
      month: 10,
      period: "2026-10",
    });
  });
});
