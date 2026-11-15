import { describe, expect, it } from "vitest";

import { latestDate } from "./site";

describe("the date a page is built from", () => {
  it("is the latest of its sources, skipping unknown ones", () => {
    expect(
      latestDate(["2026-11-09T06:00:00+00:00", null, "2026-11-15T05:10:00Z", undefined, "2026-11-01"], "x"),
    ).toBe("2026-11-15T05:10:00Z");
    expect(latestDate([null, "not a date"], "2026-11-09T06:00:00Z")).toBe("2026-11-09T06:00:00Z");
  });
});
