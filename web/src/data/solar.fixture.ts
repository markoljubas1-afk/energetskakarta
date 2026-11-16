import type { Solar } from "./solar";

/** Three columns by two rows of 0.05 degree cells from 16 E, 45 N; the middle of the bottom row is the sea. */
export const SOLAR: Solar = {
  version: 1,
  generatedAt: "2026-11-16T20:00:00+00:00",
  source: "Global Solar Atlas 2.0",
  license: "CC-BY-4.0",
  attribution: "Global Solar Atlas 2.0 (World Bank / ESMAP), solar resource data © 2019 Solargis, CC BY 4.0",
  unit: "kWh/kWp per year",
  countries: ["Croatia"],
  bounds: [16, 44.9, 16.15, 45],
  min: 1200,
  max: 1500,
  ramp: [
    [900, "#2c1a5c"],
    [1750, "#fcf0a4"],
  ],
  grid: { west: 16, north: 45, cellDeg: 0.05, cols: 3, rows: 2, values: [1200, 1250, 1300, 1400, 0, 1500] },
  image: "solar/pvout-0123456789abcdef.png",
};
