/**
 * Solar electricity per inhabitant, by country and year (pipeline/src/energymap/eurostat/solar_capita.py):
 * what a country's photovoltaic plants made in a year (Eurostat `nrg_bal_peh`) divided by the average
 * number of people who lived there that year (Eurostat `demo_gind`), in kWh.
 *
 * What it is: a calculation from two official figures, and shown as one, with both parts next to it.
 * What it is not: a figure Eurostat publishes, or what a person's own panels make. The countries are
 * compared in the latest year all of them have both figures for (`year`).
 */
import { z } from "zod";

import { assetUrl, DataError } from "./current";

const DatasetSchema = z.object({ dataset: z.string(), url: z.url(), updated: z.string().nullable() });

const YearSchema = z.object({
  year: z.number().int(),
  gwh: z.number().nonnegative(),
  people: z.number().positive(),
  kwhPerPerson: z.number().nonnegative(),
  /** Eurostat's flag on the figure ("p" provisional, "e" estimated …), or null */
  generationFlag: z.string().nullable(),
  populationFlag: z.string().nullable(),
});

export const SolarCapitaSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  license: z.string(),
  generation: DatasetSchema,
  population: DatasetSchema,
  retrievedAt: z.string(),
  /** the latest year every country has both figures for */
  year: z.number().int(),
  /** country → its years with both figures, ascending */
  countries: z.record(z.string(), z.array(YearSchema).min(1)),
  /** Eurostat's own English words for the flags in use */
  flagLabels: z.record(z.string(), z.string()),
});
export type SolarCapita = z.infer<typeof SolarCapitaSchema>;

export const SOLAR_CAPITA_KEY = "eurostat/solarcapita.json";

/** The published document for the app; null when the bucket has none yet. */
export async function loadSolarCapita(base: URL, signal: AbortSignal): Promise<SolarCapita | null> {
  const response = await fetch(assetUrl(base, SOLAR_CAPITA_KEY), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new DataError(`solar electricity per inhabitant returned HTTP ${response.status}`);
  return SolarCapitaSchema.parse(await response.json());
}

export interface Standing {
  country: string;
  year: number;
  kwhPerPerson: number;
  gwh: number;
  people: number;
  /** Eurostat's flags on the two figures, the ones that are there */
  flags: string[];
  /** 1 for the country with the most per inhabitant */
  place: number;
  /** how many countries are compared */
  of: number;
  /** the year before, when the country has it */
  previous: { year: number; kwhPerPerson: number } | null;
}

/** The countries in the year of comparison, the one with the most per inhabitant first. */
export function standings(doc: SolarCapita): Standing[] {
  const rows = Object.entries(doc.countries).flatMap(([country, years]) => {
    const now = years.find((each) => each.year === doc.year);
    if (!now) return [];
    const before = years.find((each) => each.year === doc.year - 1);
    return [
      {
        country,
        year: now.year,
        kwhPerPerson: now.kwhPerPerson,
        gwh: now.gwh,
        people: now.people,
        flags: [now.generationFlag, now.populationFlag].filter((flag): flag is string => flag !== null),
        previous: before ? { year: before.year, kwhPerPerson: before.kwhPerPerson } : null,
      },
    ];
  });
  rows.sort((a, b) => b.kwhPerPerson - a.kwhPerPerson || a.country.localeCompare(b.country));
  return rows.map((row, at) => ({ ...row, place: at + 1, of: rows.length }));
}

/** The countries a picture can be made for, in the order given. */
export function solarCapitaCountries(doc: SolarCapita, order: readonly string[]): string[] {
  const there = new Set(standings(doc).map((row) => row.country));
  return order.filter((country) => there.has(country));
}
