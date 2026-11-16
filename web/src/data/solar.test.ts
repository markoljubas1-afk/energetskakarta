import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../test/render";
import { loadSolar, solarImage, SolarSchema, valueAt } from "./solar";
import { SOLAR } from "./solar.fixture";

const BASE = new URL("https://podaci.test/");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("solar potential", () => {
  it("is what the pipeline writes, and takes its picture only from our solar folder", () => {
    expect(SolarSchema.parse(SOLAR)).toEqual(SOLAR);
    expect(() => SolarSchema.parse({ ...SOLAR, image: "https://elsewhere.test/a.png" })).toThrow();
    expect(solarImage(SOLAR, BASE)).toEqual({
      url: "https://podaci.test/solar/pvout-0123456789abcdef.png",
      bounds: [16, 44.9, 16.15, 45],
    });
  });

  it("reads the value of the cell a place falls in, and nothing for the sea or outside the data", () => {
    expect(valueAt(SOLAR, 16.01, 44.99)).toBe(1200);
    expect(valueAt(SOLAR, 16.149, 44.951)).toBe(1300);
    expect(valueAt(SOLAR, 16.02, 44.93)).toBe(1400);
    expect(valueAt(SOLAR, 16.07, 44.92)).toBeNull();
    expect(valueAt(SOLAR, 15.99, 44.99)).toBeNull();
    expect(valueAt(SOLAR, 16.16, 44.99)).toBeNull();
    expect(valueAt(SOLAR, 16.01, 45.01)).toBeNull();
    expect(valueAt(SOLAR, 16.01, 44.89)).toBeNull();
  });

  it("treats a bucket without it as that, and a grid of the wrong size as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    expect(await loadSolar(BASE, new AbortController().signal)).toEqual({ kind: "none" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(SOLAR)));
    expect(await loadSolar(BASE, new AbortController().signal)).toEqual({ kind: "ready", solar: SOLAR });
    const short = { ...SOLAR, grid: { ...SOLAR.grid, values: [1, 2] } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(short)));
    await expect(loadSolar(BASE, new AbortController().signal)).rejects.toThrow("does not match its size");
  });
});
