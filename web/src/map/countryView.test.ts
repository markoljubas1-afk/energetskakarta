import { describe, expect, it } from "vitest";

import { SCOPE_COUNTRIES } from "../domain";
import { COUNTRY_CENTER, SHOW_PLANTS_ZOOM } from "./countryView";

// roughly each country's extent, [west, south, east, north]
const EXTENT = {
  HR: [13.4, 42.3, 19.5, 46.6],
  SI: [13.3, 45.4, 16.7, 46.9],
  HU: [16.1, 45.7, 22.9, 48.6],
  RS: [18.8, 42.2, 23.1, 46.2],
  BA: [15.7, 42.5, 19.7, 45.3],
  ME: [18.4, 41.8, 20.4, 43.6],
  IT: [6.6, 36.6, 18.6, 47.1],
  AT: [9.5, 46.3, 17.2, 49.1],
} as const;

describe("where a country's plants are shown (Faza 57-D)", () => {
  it.each(SCOPE_COUNTRIES)("%s has a centre inside the country", (country) => {
    const [west, south, east, north] = EXTENT[country];
    const { lng, lat } = COUNTRY_CENTER[country];
    expect(lng).toBeGreaterThan(west);
    expect(lng).toBeLessThan(east);
    expect(lat).toBeGreaterThan(south);
    expect(lat).toBeLessThan(north);
  });

  it("is close enough for plants of 10 MW and plans to be drawn (pipeline tiles.py plant_minzoom)", () => {
    expect(SHOW_PLANTS_ZOOM).toBeGreaterThanOrEqual(7);
  });
});
