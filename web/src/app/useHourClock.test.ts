import { describe, expect, it } from "vitest";

import { msToNextHour } from "./useHourClock";

describe("msToNextHour", () => {
  it("counts to the next full hour", () => {
    expect(msToNextHour(new Date(2026, 10, 15, 13, 45, 30, 0))).toBe(14 * 60_000 + 30_000);
  });

  it("is a whole hour at a full hour", () => {
    expect(msToNextHour(new Date(2026, 10, 15, 13, 0, 0, 0))).toBe(3_600_000);
  });

  it("rolls over midnight and the end of a month", () => {
    expect(msToNextHour(new Date(2026, 10, 30, 23, 59, 0, 0))).toBe(60_000);
  });
});
