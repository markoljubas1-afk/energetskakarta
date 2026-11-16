import { describe, expect, it } from "vitest";

import { BREATH_EVERY_MS, BREATH_FADE_MS, breathes, breathPeak } from "./glowBreath";
import { PALETTES } from "./palette";

const on = { resting: 0.28, linesShown: true, reducedMotion: false, intro: false, spotlight: false };

describe("the grid's breath", () => {
  it("swells the dark theme's glow and never past fully opaque", () => {
    expect(breathPeak(PALETTES.dark.lineGlow)).toBeGreaterThan(PALETTES.dark.lineGlow);
    expect(breathPeak(PALETTES.dark.lineGlow)).toBeLessThanOrEqual(1);
    expect(breathPeak(0.9)).toBe(1);
  });

  it("rests between breaths: the two fades take a fraction of the period", () => {
    expect(2 * BREATH_FADE_MS).toBeLessThan(BREATH_EVERY_MS / 2);
  });

  it("happens only where there is a glow to breathe and nobody asked for stillness", () => {
    expect(breathes(on)).toBe(true);
    expect(breathes({ ...on, resting: PALETTES.light.lineGlow })).toBe(false);
    expect(breathes({ ...on, linesShown: false })).toBe(false);
    expect(breathes({ ...on, reducedMotion: true })).toBe(false);
    expect(breathes({ ...on, intro: true })).toBe(false);
    expect(breathes({ ...on, spotlight: true })).toBe(false);
  });
});
