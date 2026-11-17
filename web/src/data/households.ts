/**
 * Electricity used by households, by country and year (pipeline/src/energymap/eurostat/households.py, from
 * Eurostat's `nrg_d_hhq`), in GWh. The yardstick for "what does a megawatt mean": a year's use divided by the
 * hours of that year is the average power all households of the country draw together.
 *
 * What it is not: a moment's demand (households use more in the evening and in winter than this average), or
 * the use of one home. Every comparison made with it says "on average".
 */
import { z } from "zod";

import { assetUrl, DataError } from "./current";

export const HouseholdsSchema = z.object({
  version: z.literal(1),
  dataset: z.literal("nrg_d_hhq"),
  source: z.string(),
  sourceUrl: z.url(),
  license: z.string(),
  unit: z.literal("GWh"),
  updated: z.string().nullable(),
  retrievedAt: z.string(),
  years: z.array(z.number().int()).min(1),
  /** country → one figure per year, null where Eurostat has none */
  series: z.record(z.string(), z.array(z.number().nullable())),
  missing: z.array(z.string()),
});
export type Households = z.infer<typeof HouseholdsSchema>;

export const HOUSEHOLDS_KEY = "eurostat/households.json";

/** The published document for the app; null when the bucket has none yet. */
export async function loadHouseholds(base: URL, signal: AbortSignal): Promise<Households | null> {
  const response = await fetch(assetUrl(base, HOUSEHOLDS_KEY), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new DataError(`household consumption returned HTTP ${response.status}`);
  const doc = HouseholdsSchema.parse(await response.json());
  for (const [country, values] of Object.entries(doc.series)) {
    if (values.length !== doc.years.length) {
      throw new DataError(`household consumption: ${country} does not have one value per year`);
    }
  }
  return doc;
}

const hoursIn = (year: number): number =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 8784 : 8760;

export interface HouseholdPower {
  /** the latest year the country has a figure for */
  year: number;
  /** what all its households drew on average over that year, in MW */
  mw: number;
}

/** The average power a country's households drew in their latest reported year; null without a figure. */
export function householdPower(doc: Households, country: string): HouseholdPower | null {
  const values = doc.series[country];
  if (!values) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const gwh = values[index];
    const year = doc.years[index];
    if (gwh != null && year !== undefined) return { year, mw: (gwh * 1000) / hoursIn(year) };
  }
  return null;
}

export interface Comparison {
  power: HouseholdPower;
  /** the generation figure as a multiple of the households' average draw (0.6 = 60 % of it) */
  ratio: number;
}

/** A generation figure in MW held against the households' average draw. */
export function compare(doc: Households, country: string, mw: number): Comparison | null {
  const power = householdPower(doc, country);
  return power && power.mw > 0 ? { power, ratio: mw / power.mw } : null;
}
