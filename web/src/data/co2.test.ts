import { describe, expect, it } from "vitest";

import { TECHNOLOGIES } from "../domain";
import { defined } from "../test/defined";
import { EMISSION_FACTORS, intensity, mixIntensity } from "./co2";
import { MIX_LIVE } from "./mix.fixture";
import { gridMix, productionMix } from "./mix";

describe("carbon intensity", () => {
  it("has a factor, or a deliberate null for storage, for every technology", () => {
    for (const tech of TECHNOLOGIES) expect(tech in EMISSION_FACTORS).toBe(true);
    expect(EMISSION_FACTORS.pumped_storage).toBeNull();
    expect(EMISSION_FACTORS.battery).toBeNull();
  });

  it("weights factors by energy and leaves storage out", () => {
    expect(
      intensity([
        ["gas", 100],
        ["wind", 100],
      ]),
    ).toBe((490 + 11) / 2);
    expect(
      intensity([
        ["hydro", 100],
        ["pumped_storage", 500],
      ]),
    ).toBe(24);
    expect(intensity([["battery", 10]])).toBeNull();
    expect(intensity([])).toBeNull();
  });

  it("works on production and grid mixes", () => {
    // HR at hour 0: hydro 600, wind 200 → (600×24 + 200×11) / 800
    expect(mixIntensity(defined(productionMix(MIX_LIVE, "HR", 0)))).toBeCloseTo(
      (600 * 24 + 200 * 11) / 800,
      9,
    );
    // with imports: + nuclear 150, hydro 150 (SI), gas 200 (HU); RS of unknown make-up is not counted
    const grid = defined(gridMix(MIX_LIVE, "HR", 0));
    expect(mixIntensity(grid)).toBeCloseTo((750 * 24 + 200 * 11 + 200 * 490 + 150 * 12) / 1300, 9);
  });
});
