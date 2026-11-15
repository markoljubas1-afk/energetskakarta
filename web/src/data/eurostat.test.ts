import { describe, expect, it } from "vitest";

import { checkedRenewables, latestShare, RenewablesSchema, shareAt } from "./eurostat";
import { SAMPLE_RENEWABLES } from "./eurostat.fixture";

describe("official renewable shares (Eurostat)", () => {
  it("accepts the document the pipeline writes", () => {
    expect(RenewablesSchema.parse(SAMPLE_RENEWABLES)).toEqual(SAMPLE_RENEWABLES);
    expect(checkedRenewables(SAMPLE_RENEWABLES)).toBe(SAMPLE_RENEWABLES);
  });

  it("refuses a series that is not one value per year", () => {
    const short = {
      ...SAMPLE_RENEWABLES,
      series: { ...SAMPLE_RENEWABLES.series, SI: { REN: [20, 21] } },
    };
    expect(() => checkedRenewables(short)).toThrow(/SI REN does not have one value per year/);
  });

  it("reads a year's share with its flag", () => {
    expect(shareAt(SAMPLE_RENEWABLES, "HR", "REN", 2024)).toEqual({ year: 2024, value: 34.1, flag: "p" });
    expect(shareAt(SAMPLE_RENEWABLES, "HR", "REN_TRA", 2020)).toEqual({ year: 2020, value: 8, flag: "b" });
    expect(shareAt(SAMPLE_RENEWABLES, "HR", "REN", 2013)).toBeNull();
    expect(shareAt(SAMPLE_RENEWABLES, "ME", "REN", 2024)).toBeNull();
  });

  it("falls back to the latest earlier year for an area that reports later", () => {
    expect(latestShare(SAMPLE_RENEWABLES, "HR", "REN")?.year).toBe(2024);
    expect(latestShare(SAMPLE_RENEWABLES, "BA", "REN", 2024)).toEqual({ year: 2023, value: 49, flag: null });
    expect(latestShare(SAMPLE_RENEWABLES, "HR", "REN", 2020)?.value).toBe(30.1);
    expect(latestShare(SAMPLE_RENEWABLES, "ME", "REN")).toBeNull();
  });
});
