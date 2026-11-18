import { describe, expect, it } from "vitest";

import { carbonAt, shownGrams } from "./carbon";
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
    expect(carbon?.covered).toBe(1);
    expect(carbon?.fossil).toEqual(["gas"]);
    if (!carbon) throw new Error("reported");
    expect(shownGrams(carbon)).toBe(140);
  });

  it("counts lignite with the one figure the source has for coal, and lists fossil sources largest first", () => {
    const carbon = carbonAt(one({ lignite: 600, gas: 100, coal: 300 }), "XX", 0);
    expect(carbon?.gPerKwh).toBeCloseTo((900 * 820 + 100 * 490) / 1000, 6);
    expect(carbon?.fossil).toEqual(["lignite", "coal", "gas"]);
  });

  it("leaves out what the source has no factor for, and gives nothing when that is too much", () => {
    // oil and "other" are 5 % of the hour: the footprint is of the other 95 %
    const mostly = carbonAt(one({ hydro: 950, oil: 30, other: 20 }), "XX", 0);
    expect(mostly?.gPerKwh).toBeCloseTo(24, 6);
    expect(mostly?.covered).toBeCloseTo(0.95, 6);
    expect(mostly?.fossil).toEqual([]);
    // a fifth without a factor: no figure rather than a figure of the rest
    expect(carbonAt(one({ hydro: 800, other: 200 }), "XX", 0)).toBeNull();
  });

  it("gives nothing for an hour or a country that did not report", () => {
    expect(carbonAt(GREEN_LIVE, "HR", 40)).toBeNull();
    expect(carbonAt(GREEN_LIVE, "ME", 33)).toBeNull();
    expect(carbonAt(GREEN_LIVE, "IT", 33)).toBeNull();
    expect(carbonAt(one({ pumped_storage: 100 }), "XX", 0)).toBeNull();
  });
});
