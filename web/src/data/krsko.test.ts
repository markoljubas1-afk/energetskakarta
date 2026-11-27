import { describe, expect, it } from "vitest";

import { createI18n } from "../i18n";
import { PeriodsSchema, YearFileSchema, type Periods, type YearFile } from "./energy";
import {
  krskoHalfOfHour,
  krskoHalfOfPeriod,
  krskoHalfOfRange,
  krskoNote,
  krskoPictureNote,
  KRSKO_ID,
} from "./krsko";
import { MIX_LIVE } from "./mix.fixture";

const block = (periods: string[], nuclear: (number | null)[], coverage: number[]) => ({
  periods,
  generation: { nuclear, hydro: periods.map(() => 100) },
  consumption: {},
  load: periods.map(() => 1000),
  coverage: { generation: coverage, load: coverage },
});

const PERIODS: Periods = PeriodsSchema.parse({
  version: 1,
  unit: "MWh",
  countries: {
    // 2025-02 only partly reported, 2025-03 the plant stood still (refuelling)
    SI: {
      months: block(["2025-01", "2025-02", "2025-03"], [480, 300, 0], [1, 0.6, 1]),
      years: block(["2024", "2025"], [5550, 2000], [0.9998, 0.4]),
    },
  },
});

const day = (days: string[], nuclear: (number | null)[], coverage: number[]): YearFile =>
  YearFileSchema.parse({
    version: 1,
    year: 2025,
    unit: "MWh",
    days,
    countries: {
      SI: {
        generation: { nuclear },
        consumption: {},
        load: days.map(() => 30),
        coverage: { generation: coverage, load: coverage },
      },
    },
  });

describe("Croatia's half of Krško", () => {
  it("is half of Slovenia's nuclear generation in a fully reported month or year", () => {
    expect(krskoHalfOfPeriod(PERIODS, "month", "2025-01")).toBe(240);
    // 0.9998: a handful of hours missing in a year is still the year
    expect(krskoHalfOfPeriod(PERIODS, "year", "2024")).toBe(2775);
  });

  it("is not given for a partly reported period, a standstill or a period without data", () => {
    expect(krskoHalfOfPeriod(PERIODS, "month", "2025-02")).toBeNull();
    expect(krskoHalfOfPeriod(PERIODS, "year", "2025")).toBeNull();
    expect(krskoHalfOfPeriod(PERIODS, "month", "2025-03")).toBeNull();
    expect(krskoHalfOfPeriod(PERIODS, "month", "2024-12")).toBeNull();
    expect(
      krskoHalfOfPeriod(PeriodsSchema.parse({ version: 1, unit: "MWh", countries: {} }), "year", "2024"),
    ).toBeNull();
  });

  it("sums a range of days only when every day was reported", () => {
    const files = [
      day(["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"], [16, 18, null, 12], [1, 1, 0, 0.9]),
    ];
    expect(krskoHalfOfRange(files, "2025-01-01", "2025-01-02")).toBe(17);
    expect(krskoHalfOfRange(files, "2025-01-02", "2025-01-02")).toBe(9);
    expect(krskoHalfOfRange(files, "2025-01-01", "2025-01-03")).toBeNull();
    // a day with missing hours would give too small a half
    expect(krskoHalfOfRange(files, "2025-01-04", "2025-01-04")).toBeNull();
    // a day outside the files is not a day of zero
    expect(krskoHalfOfRange(files, "2025-01-02", "2025-01-05")).toBeNull();
    expect(krskoHalfOfRange([], "2025-01-01", "2025-01-02")).toBeNull();
    expect(krskoHalfOfRange(files, "2025-01-02", "2025-01-01")).toBeNull();
  });

  it("is half of the hour's nuclear power, and nothing for an hour Slovenia did not report", () => {
    expect(krskoHalfOfHour(MIX_LIVE, 0)).toBe(250);
    const gap = structuredClone(MIX_LIVE);
    gap.generation = { ...gap.generation, SI: { nuclear: [500, null, 500], hydro: [500, 500, 500] } };
    expect(krskoHalfOfHour(gap, 1)).toBeNull();
    expect(krskoHalfOfHour({ ...MIX_LIVE, generation: {} }, 0)).toBeNull();
  });

  it("is the operating plant, not the planned block next to it", () => {
    expect(KRSKO_ID).toBe("osm:way/89819245");
  });
});

describe("the note", () => {
  const hr = createI18n("hr");
  const en = createI18n("en");

  it("tells Croatia that its half is counted as an import, with the share of consumption when known", () => {
    expect(krskoNote(hr, "HR", "2,8 TWh", "15 %")).toBe(
      "Hrvatskoj pripada i polovica proizvodnje Nuklearne elektrane Krško, oko 2,8 TWh (15 % potrošnje). Elektrana je u Sloveniji, pa ENTSO-E njezinu proizvodnju vodi kao slovensku, a dio koji preuzima HEP kao uvoz u Hrvatsku.",
    );
    expect(krskoNote(en, "HR", "250 MW", null)).toBe(
      "Croatia also owns half of the output of the Krško nuclear plant, about 250 MW. The plant is in Slovenia, so ENTSO-E counts its generation as Slovenian and the part HEP takes as an import into Croatia.",
    );
  });

  it("tells Slovenia that half of it belongs to Croatia", () => {
    expect(krskoNote(hr, "SI", "2,8 TWh", "15 %")).toBe(
      "Polovica proizvodnje Nuklearne elektrane Krško, oko 2,8 TWh, pripada Hrvatskoj (HEP). Ovdje je, kao i u ENTSO-E-u, uračunata u slovensku proizvodnju.",
    );
  });

  it("says nothing for other countries or without a figure", () => {
    expect(krskoNote(hr, "HU", "2,8 TWh", null)).toBeNull();
    expect(krskoNote(hr, "ALL", "2,8 TWh", null)).toBeNull();
    expect(krskoNote(hr, "HR", null, null)).toBeNull();
  });
});

describe("Krško on a picture of a chart", () => {
  const hr = createI18n("hr");
  it("gives the figure when the chart has one period, with the share of consumption when known", () => {
    expect(krskoPictureNote(hr, "HR", 2_775_000, 18_230_000)?.replace(/\p{Zs}/gu, " ")).toContain(
      "oko 2,78 TWh (15,2 % potrošnje)",
    );
    expect(krskoPictureNote(hr, "SI", 2_775_000, null)?.replace(/\p{Zs}/gu, " ")).toContain(
      "oko 2,78 TWh, pripada Hrvatskoj (HEP)",
    );
  });

  it("says it without a figure for a chart of many periods, or a period not reported in full", () => {
    expect(krskoPictureNote(hr, "HR", null, null)).toBe(hr.t("krskoCountryHr"));
    expect(krskoPictureNote(hr, "SI", null, 1)).toBe(hr.t("krskoCountrySi"));
    expect(krskoPictureNote(hr, "HU", 1, 1)).toBeNull();
    expect(krskoPictureNote(hr, "ALL", null, null)).toBeNull();
  });
});
