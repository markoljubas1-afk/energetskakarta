import { describe, expect, it } from "vitest";

import { MIX_LIVE as LIVE } from "./mix.fixture";
import { generationAt, gridMix, latestWithData, mixCountries, productionMix } from "./mix";

describe("electricity mix", () => {
  it("reads one hour of generation and refuses an hour that was not fully reported", () => {
    expect(generationAt(LIVE, "HR", 0)).toEqual(
      new Map([
        ["hydro", 600],
        ["wind", 200],
        ["solar", 0],
      ]),
    );
    expect(generationAt(LIVE, "HR", 2)).toBeNull();
    expect(generationAt(LIVE, "RS", 0)).toBeNull();
  });

  it("falls back to the latest hour with data", () => {
    expect(latestWithData(LIVE, "HR", 2)).toBe(1);
    expect(latestWithData(LIVE, "RS", 2)).toBeNull();
    expect(productionMix(LIVE, "HR", 2)?.index).toBe(1);
  });

  it("shares a country's own production", () => {
    const mix = productionMix(LIVE, "HR", 0);
    expect(mix?.totalMw).toBe(800);
    expect(mix?.technologies.map((t) => [t.technology, t.share])).toEqual([
      ["hydro", 0.75],
      ["wind", 0.25],
    ]);
  });

  it("adds imports split by the exporter's production, and keeps an unknown exporter apart", () => {
    const mix = gridMix(LIVE, "HR", 0);
    // own 800 + SI 300 (half nuclear, half hydro) + HU 200 gas + RS 50 unknown; the export to BA changes no share
    expect(mix?.totalMw).toBe(1350);
    const mw = Object.fromEntries(mix?.technologies.map((t) => [t.technology, t.mw]) ?? []);
    expect(mw).toEqual({ hydro: 750, wind: 200, gas: 200, nuclear: 150 });
    expect(mix?.unknownImportMw).toBe(50);
    expect(mix?.imports.map((i) => [i.country, i.mw, i.known])).toEqual([
      ["SI", 300, true],
      ["HU", 200, true],
      ["RS", 50, false],
    ]);
    expect(mix?.incomplete).toBe(false);
  });

  it("says when a border had no flow in that hour", () => {
    const mix = gridMix(LIVE, "HR", 1);
    expect(mix?.incomplete).toBe(true);
    expect(mix?.imports.map((i) => i.country)).toEqual(["SI", "RS"]);
  });

  it("lists the countries that report generation", () => {
    expect(mixCountries(LIVE)).toEqual(["HR", "SI", "HU"]);
  });
});
