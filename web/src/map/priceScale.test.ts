import { describe, expect, it } from "vitest";

import { PALETTES } from "./palette";
import { priceColor, priceFill, priceGradient, priceTickAt } from "./priceScale";

const stops = PALETTES.light.price.stops;

describe("price scale", () => {
  it("hits the stops exactly and clamps beyond them", () => {
    expect(priceColor(0, stops)).toBe("#E4E7EA");
    expect(priceColor(-50, stops)).toBe("#3D7FB8");
    expect(priceColor(-400, stops)).toBe("#3D7FB8");
    expect(priceColor(200, stops)).toBe("#B5532F");
    expect(priceColor(3000, stops)).toBe("#B5532F");
  });

  it("blends between the two stops around a price", () => {
    // halfway between #E4E7EA (0) and #D9A35B (100)
    expect(priceColor(50, stops)).toBe("#DFC5A3");
  });

  it("treats a missing number as the cold end rather than throwing mid-render", () => {
    expect(priceColor(Number.NaN, stops)).toBe("#3D7FB8");
  });

  it("paints only the countries that have a price and nothing else", () => {
    expect(priceFill({ HR: 0, SI: 200 }, stops)).toEqual([
      "match",
      ["get", "code"],
      "HR",
      "#E4E7EA",
      "SI",
      "#B5532F",
      "rgba(0, 0, 0, 0)",
    ]);
    expect(priceFill({}, stops)).toBeNull();
  });

  it("places every stop and tick on the legend's range", () => {
    expect(priceGradient(stops)).toBe(
      "linear-gradient(90deg, #3D7FB8 0.0%, #E4E7EA 16.7%, #D9A35B 50.0%, #B5532F 83.3%)",
    );
    expect(priceTickAt(-50)).toBe(0);
    expect(priceTickAt(100)).toBe(0.5);
  });

  it("has stops for both themes in rising order", () => {
    for (const palette of Object.values(PALETTES)) {
      const values = palette.price.stops.map(([eur]) => eur);
      expect([...values].sort((a, b) => a - b)).toEqual(values);
      expect(values).toContain(0);
    }
  });
});
