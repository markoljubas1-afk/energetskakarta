import { describe, expect, it } from "vitest";

import {
  archiveUrl,
  currentUrl,
  MIN_DAYS,
  roundCoord,
  solarNowKw,
  yearlyIrradiation,
  yieldPerKwp,
} from "./weather";

describe("weather for near me", () => {
  it("sends only a rounded location", () => {
    expect(roundCoord(45.81449)).toBe(45.81);
    expect(currentUrl(45.81449, 15.97798)).toContain("latitude=45.81&longitude=15.98");
    expect(currentUrl(45.8, 16)).toContain("current=cloud_cover,shortwave_radiation,is_day");
  });

  it("asks the archive for the last 365 complete days", () => {
    const url = archiveUrl(43.5, 16.44, new Date("2026-11-15T10:00:00Z"));
    expect(url).toContain("start_date=2025-11-08&end_date=2026-11-07");
    expect(url).toContain("daily=shortwave_radiation_sum");
  });

  it("turns daily MJ/m² into a yearly kWh/m², scaling up a few missing days", () => {
    expect(yearlyIrradiation(new Array<number>(365).fill(3.6))).toBe(365);
    const gaps = [...new Array<number>(330).fill(3.6), ...new Array<null>(35).fill(null)];
    expect(yearlyIrradiation(gaps)).toBeCloseTo(365, 6);
    expect(yearlyIrradiation(new Array<number>(MIN_DAYS - 1).fill(3.6))).toBeNull();
  });

  it("estimates solar output now and over a year", () => {
    expect(solarNowKw(10, 500)).toBeCloseTo(4, 6);
    expect(solarNowKw(10, 0)).toBe(0);
    // Zagreb gets about 1 300 kWh/m² a year: about 1 165 kWh per kWp
    expect(Math.round(yieldPerKwp(1300))).toBe(1165);
  });
});
