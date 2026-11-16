import { describe, expect, it } from "vitest";

import {
  ageHours,
  band,
  changeFromYesterday,
  greenAt,
  greenCountries,
  latestGreen,
  STALE_AFTER_HOURS,
} from "./greenShare";
import type { Live } from "./live";

/** Two days of hours, 2026-11-15 00:00 to 2026-11-16 23:00 local. */
const HOURS = Array.from({ length: 48 }, (_, i) => {
  const day = 15 + Math.floor(i / 24);
  return `2026-11-${String(day)}T${String(i % 24).padStart(2, "0")}:00:00+01:00`;
});
const column = (fill: (index: number) => number | null): (number | null)[] => HOURS.map((_, i) => fill(i));

const LIVE: Live = {
  version: 1,
  generatedAt: "2026-11-16T10:05:00+00:00",
  timezone: "Europe/Zagreb",
  hours: HOURS,
  flows: [],
  prices: {},
  generation: {
    HR: {
      // reported up to 2026-11-16 09:00 (index 33); nothing after
      hydro: column((i) => (i <= 33 ? 600 : null)),
      wind: column((i) => (i <= 33 ? (i === 33 ? 300 : 100) : null)),
      gas: column((i) => (i <= 33 ? 300 : null)),
      pumped_storage: column((i) => (i <= 33 ? 100 : null)),
      // a name the map does not know is not counted, rather than guessed at
      marine: column(() => 500),
    },
    SI: { nuclear: column(() => 700), hydro: column(() => 100), solar: column(() => 0) },
    // listed, but never reported
    ME: { hydro: column(() => null) },
  },
  missing: { flows: [], prices: [] },
};

describe("how green the electricity is", () => {
  it("is the renewable share of what the country's own plants generated in the hour", () => {
    const green = greenAt(LIVE, "HR", 33);
    // hydro 600 + wind 300 of 1300; pumped storage is generation but not renewable
    expect(green?.totalMw).toBe(1300);
    expect(green?.renewableMw).toBe(900);
    expect(green?.share).toBeCloseTo(900 / 1300, 6);
    expect(green?.top).toEqual({ technology: "hydro", mw: 600 });
    expect(green?.hour).toBe("2026-11-16T09:00:00+01:00");
    expect(greenAt(LIVE, "SI", 0)?.share).toBeCloseTo(100 / 800, 6);
    expect(greenAt(LIVE, "SI", 0)?.top.technology).toBe("nuclear");
  });

  it("has nothing to say for an hour or a country that did not report", () => {
    expect(greenAt(LIVE, "HR", 34)).toBeNull();
    expect(greenAt(LIVE, "ME", 10)).toBeNull();
    expect(greenAt(LIVE, "IT", 10)).toBeNull();
    expect(greenAt(LIVE, "HR", 99)).toBeNull();
    expect(greenCountries(LIVE)).toEqual(["HR", "SI"]);
  });

  it("finds the latest reported hour that is not in the future", () => {
    const noon = new Date("2026-11-16T12:30:00+01:00");
    expect(latestGreen(LIVE, "HR", noon)?.index).toBe(33);
    // Slovenia's column is filled to the end of tomorrow; only hours up to now count
    expect(latestGreen(LIVE, "SI", noon)?.hour).toBe("2026-11-16T12:00:00+01:00");
    expect(latestGreen(LIVE, "HR", new Date("2026-11-14T12:00:00+01:00"))).toBeNull();
  });

  it("compares with the same hour the day before", () => {
    const green = greenAt(LIVE, "HR", 33);
    if (!green) throw new Error("the fixture reports this hour");
    // yesterday 09:00: hydro 600 + wind 100 of 1100
    expect(changeFromYesterday(LIVE, "HR", green)).toBeCloseTo(900 / 1300 - 700 / 1100, 6);
    const first = greenAt(LIVE, "HR", 5);
    expect(first && changeFromYesterday(LIVE, "HR", first)).toBeNull();
  });

  it("sorts the share into three stated bands", () => {
    expect(band(0)).toBe("low");
    expect(band(0.349)).toBe("low");
    expect(band(0.35)).toBe("mid");
    expect(band(0.649)).toBe("mid");
    expect(band(0.65)).toBe("high");
    expect(band(1)).toBe("high");
  });

  it("knows how old its figures are", () => {
    const green = greenAt(LIVE, "HR", 33);
    if (!green) throw new Error("the fixture reports this hour");
    // the hour 09:00 to 10:00 ended at 10:00
    expect(ageHours(green, new Date("2026-11-16T10:20:00+01:00"))).toBe(0);
    expect(ageHours(green, new Date("2026-11-16T12:59:00+01:00"))).toBe(2);
    expect(ageHours(green, new Date("2026-11-16T17:00:00+01:00"))).toBe(7);
    expect(ageHours(green, new Date("2026-11-16T09:30:00+01:00"))).toBe(0);
    expect(STALE_AFTER_HOURS).toBe(4);
  });
});
