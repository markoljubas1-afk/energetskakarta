/**
 * Solar potential (pipeline solar/potential.py): the expected yearly output of a photovoltaic system, from
 * the Global Solar Atlas 2.0 (World Bank / ESMAP, data © Solargis, CC BY 4.0). One picture of the region
 * for the map, and a coarser grid of values for reading a number off a place.
 *
 * A model's long-term average, in kWh per installed kWp a year: not a measurement, and not a statement
 * about a site (it knows nothing of shading, land use, protected areas or the grid).
 */
import { z } from "zod";

import { assetUrl, DataError } from "./current";

const Colour = z.string().regex(/^#[0-9a-f]{6}$/);

export const SolarSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  license: z.string(),
  attribution: z.string(),
  unit: z.string(),
  countries: z.array(z.string()),
  /** west, south, east, north of the picture, in degrees */
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  min: z.number(),
  max: z.number(),
  /** value → colour, ascending: the picture's own colours, for the legend */
  ramp: z.array(z.tuple([z.number(), Colour])).min(2),
  grid: z.object({
    west: z.number(),
    north: z.number(),
    cellDeg: z.number().positive(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    /** rows from north to south, each from west to east; 0 means "no data here" */
    values: z.array(z.number().int().nonnegative()),
  }),
  image: z.string().regex(/^solar\/pvout-[0-9a-f]{16}\.png$/),
});
export type Solar = z.infer<typeof SolarSchema>;

export type SolarLoad = { kind: "none" } | { kind: "ready"; solar: Solar };

export const SOLAR_KEY = "solar/index.json";

export async function loadSolar(base: URL, signal: AbortSignal): Promise<SolarLoad> {
  const response = await fetch(assetUrl(base, SOLAR_KEY), { signal });
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) throw new DataError(`solar potential returned HTTP ${response.status}`);
  const solar = SolarSchema.parse(await response.json());
  if (solar.grid.values.length !== solar.grid.cols * solar.grid.rows) {
    throw new DataError("solar potential grid does not match its size");
  }
  return { kind: "ready", solar };
}

/** What the map needs to draw the picture: its address and its four corners. */
export interface SolarImage {
  url: string;
  /** west, south, east, north */
  bounds: [number, number, number, number];
}

export function solarImage(solar: Solar, base: URL): SolarImage {
  return { url: assetUrl(base, solar.image), bounds: solar.bounds };
}

/** The value at a place, in kWh/kWp a year; null outside the data or where the atlas has none (the sea). */
export function valueAt(solar: Solar, lng: number, lat: number): number | null {
  const { west, north, cellDeg, cols, rows, values } = solar.grid;
  const col = Math.floor((lng - west) / cellDeg);
  const row = Math.floor((north - lat) / cellDeg);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  const value = values[row * cols + col];
  return value === undefined || value === 0 ? null : value;
}

/**
 * The rated power of one panel the calculator counts with, in watts: an ordinary rooftop panel of the day.
 * It is the calculator's one assumption and is printed next to the result.
 */
export const PANEL_W = 430;

export interface RoofSystem {
  /** installed power that would generate the yearly consumption at this place, in kWp (one decimal) */
  kwp: number;
  /** how many panels of `PANEL_W` that is, rounded up */
  panels: number;
}

/**
 * The system that generates as much in an average year as a household uses in a year: consumption divided by
 * the place's yield (kWh per installed kWp a year, from the atlas). A yearly balance and nothing more: it says
 * nothing of when the electricity is made (most in summer, at noon) or how much of it the house uses itself.
 */
export function roofSystem(yearlyKwh: number, yieldKwhPerKwp: number): RoofSystem | null {
  if (!(yearlyKwh > 0) || !(yieldKwhPerKwp > 0)) return null;
  const kwp = Math.round((yearlyKwh / yieldKwhPerKwp) * 10) / 10;
  return { kwp, panels: Math.ceil((kwp * 1000) / PANEL_W) };
}
