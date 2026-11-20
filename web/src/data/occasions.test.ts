import { describe, expect, it } from "vitest";

import { en } from "../i18n/en";
import { hr } from "../i18n/hr";
import { easter, leadsToLive, occasionOn, OCCASIONS, orthodoxEaster, zagrebDay } from "./occasions";

/** Noon in Zagreb on a day (CET or CEST: noon UTC is the same calendar day in both). */
const on = (day: string): Date => new Date(`${day}T11:00:00Z`);
const key = (day: string): string | null => occasionOn(on(day))?.key ?? null;

describe("the Easters", () => {
  it("are the Sundays the calendars give", () => {
    const western = [2026, 2027, 2028, 2029, 2030].map((year) => easter(year));
    expect(western.map(({ month, day }) => `${String(month)}-${String(day)}`)).toEqual([
      "4-5",
      "3-28",
      "4-16",
      "4-1",
      "4-21",
    ]);
    const eastern = [2026, 2027, 2028, 2029, 2030].map((year) => orthodoxEaster(year));
    expect(eastern.map(({ month, day }) => `${String(month)}-${String(day)}`)).toEqual([
      "4-12",
      "5-2",
      "4-16",
      "4-8",
      "4-28",
    ]);
  });
});

describe("occasionOn", () => {
  it("knows the single days", () => {
    expect(key("2026-07-10")).toBe("tesla");
    expect(key("2026-12-04")).toBe("miners");
    expect(key("2027-03-05")).toBe("efficiency");
    expect(key("2027-06-15")).toBe("wind");
    expect(key("2027-04-22")).toBe("earth");
    expect(key("2027-03-08")).toBe("women");
    expect(key("2026-11-19")).toBe("men");
    expect(key("2026-11-20")).toBeNull();
    expect(key("2026-07-11")).toBeNull();
  });

  it("keeps Easter from Good Friday to Easter Monday, in both calendars", () => {
    // 2026: 5 April and 12 April
    expect(key("2026-04-02")).toBeNull();
    expect(key("2026-04-03")).toBe("easter");
    expect(key("2026-04-06")).toBe("easter");
    expect(key("2026-04-07")).toBeNull();
    expect(key("2026-04-10")).toBe("orthodoxEaster");
    expect(key("2026-04-13")).toBe("orthodoxEaster");
    expect(key("2026-04-14")).toBeNull();
    // 2028: both on 16 April, one greeting
    expect(key("2028-04-16")).toBe("easter");
    // 2030: Earth Day falls on Easter Monday and goes first
    expect(key("2030-04-21")).toBe("easter");
    expect(key("2030-04-22")).toBe("earth");
  });

  it("runs Christmas into the New Year and gives the days after it to the year that ended", () => {
    expect(key("2026-12-14")).toBeNull();
    expect(key("2026-12-15")).toBe("christmas");
    expect(key("2026-12-26")).toBe("christmas");
    expect(occasionOn(on("2026-12-27"))).toEqual({ key: "newYear", year: 2026 });
    expect(occasionOn(on("2027-01-05"))).toEqual({ key: "newYear", year: 2026 });
    expect(occasionOn(on("2027-01-06"))).toEqual({ key: "orthodoxChristmas", year: 2027 });
    expect(key("2027-01-07")).toBe("orthodoxChristmas");
    expect(key("2027-01-08")).toBeNull();
  });

  it("reads the day in Zagreb, not in the reader's zone", () => {
    // 9 July 22:30 UTC is already Tesla's day in Zagreb (00:30)
    expect(zagrebDay(new Date("2026-07-09T22:30:00Z"))).toEqual({ year: 2026, month: 7, day: 10 });
    expect(occasionOn(new Date("2026-07-09T22:30:00Z"))?.key).toBe("tesla");
    // and 10 July 22:30 UTC is the 11th there
    expect(occasionOn(new Date("2026-07-10T22:30:00Z"))).toBeNull();
  });

  it("has words for every occasion in both languages, and a live layer only where they point at it", () => {
    for (const occasion of OCCASIONS) {
      for (const texts of [hr, en]) {
        expect(texts[`occasion_${occasion}_title`]).not.toBe("");
        expect(texts[`occasion_${occasion}_text`]).not.toBe("");
      }
    }
    expect(OCCASIONS.filter(leadsToLive)).toEqual(["efficiency", "wind", "earth", "easter"]);
  });
});
