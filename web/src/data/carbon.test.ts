import { describe, expect, it } from "vitest";

import { carbonAt, shownGrams } from "./carbon";
import { intensity } from "./co2";
import { GREEN_LIVE } from "./greenShare.fixture";
import type { Live } from "./live";

const one = (generation: Record<string, number | null>): Live => ({
  ...GREEN_LIVE,
  hours: ["2026-11-16T09:00:00+01:00"],
  generation: { XX: Object.fromEntries(Object.entries(generation).map(([tech, mw]) => [tech, [mw]])) },
});

describe("carbon footprint of an hour's generation", () => {
  it("weighs each source by its factor; storage is not a source", () => {
    // Croatia 09:00: hydro 600 (24 g), wind 300 (11 g), gas 300 (490 g); pumped storage 100 is left out
    const carbon = carbonAt(GREEN_LIVE, "HR", 33);
    expect(carbon?.gPerKwh).toBeCloseTo((600 * 24 + 300 * 11 + 300 * 490) / 1200, 6);
    expect(carbon?.fossil).toEqual(["gas"]);
    if (!carbon) throw new Error("reported");
    expect(shownGrams(carbon)).toBe(140);
  });

  it("counts lignite with the one figure the source has for coal, and lists fossil sources largest first", () => {
    const carbon = carbonAt(one({ lignite: 600, gas: 100, coal: 300 }), "XX", 0);
    expect(carbon?.gPerKwh).toBeCloseTo((900 * 820 + 100 * 490) / 1000, 6);
    expect(carbon?.fossil).toEqual(["lignite", "coal", "gas"]);
  });

  it("counts oil and unclassified generation with the site's two stated assumptions, like every other page", () => {
    // the IPCC table has no figure for them: co2.ts assumes 650 and 700 g/kWh
    const carbon = carbonAt(one({ hydro: 950, oil: 30, other: 20 }), "XX", 0);
    expect(carbon?.gPerKwh).toBeCloseTo((950 * 24 + 30 * 650 + 20 * 700) / 1000, 6);
    expect(carbon?.fossil).toEqual([]);
    // the same hour through the site's one calculation gives the same figure
    expect(carbon?.gPerKwh).toBe(
      intensity([
        ["hydro", 950],
        ["oil", 30],
        ["other", 20],
      ]),
    );
  });

  it("gives nothing for an hour or a country that did not report", () => {
    expect(carbonAt(GREEN_LIVE, "HR", 40)).toBeNull();
    expect(carbonAt(GREEN_LIVE, "ME", 33)).toBeNull();
    expect(carbonAt(GREEN_LIVE, "IT", 33)).toBeNull();
    expect(carbonAt(one({ pumped_storage: 100 }), "XX", 0)).toBeNull();
  });
});
