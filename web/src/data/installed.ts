/**
 * Installed generation capacity per source, by country and year (pipeline/src/energymap/entsoe/installed.py):
 * what the transmission operators report to the ENTSO-E Transparency Platform (A68, "installed capacity per
 * production type"), joined into the map's technologies.
 *
 * A year's figure is the capacity at the start of that year: the platform publishes it for the year ahead,
 * so in December some countries already have the next year. It counts every plant connected, the small
 * rooftop ones too, which is why it differs from the sum of the plants on the map. Slovenia's nuclear is the
 * whole of Krško, half of which is Croatia's.
 */
import { z } from "zod";

import { TECHNOLOGIES, type Technology } from "../domain";

const YearSchema = z.object({
  year: z.number().int(),
  total: z.number().positive(),
  /** MW per technology; a technology the country does not have is absent */
  mw: z.partialRecord(z.enum(TECHNOLOGIES), z.number().positive()),
});
export type InstalledYear = z.infer<typeof YearSchema>;

export const InstalledSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  sourceUrl: z.url(),
  license: z.string(),
  documentType: z.literal("A68"),
  retrievedAt: z.string(),
  /** the latest year every country has */
  year: z.number().int(),
  /** country → its years, ascending */
  countries: z.record(z.string(), z.array(YearSchema).min(1)),
  contentHash: z.string(),
});
export type Installed = z.infer<typeof InstalledSchema>;

export const INSTALLED_KEY = "energy/capacity.json";

/** How many years back the growth of a source is measured. */
export const GROWTH_YEARS = 5;

export interface InstalledSource {
  tech: Technology;
  mw: number;
  /** the same source GROWTH_YEARS earlier: 0 when the country had none then, null when that year is unknown */
  before: number | null;
}

export interface InstalledCountry {
  /** the latest year the country has */
  latest: InstalledYear;
  /** the year GROWTH_YEARS before it, when the country has it */
  earlier: InstalledYear | null;
  /** the latest year's sources, the largest first */
  sources: InstalledSource[];
  /** every year, the newest first */
  years: InstalledYear[];
}

/** One country's capacity for a page; null when the document has none for it. */
export function installedCountry(doc: Installed, code: string): InstalledCountry | null {
  const years = doc.countries[code];
  const latest = years?.at(-1);
  if (!years || !latest) return null;
  const earlier = years.find((each) => each.year === latest.year - GROWTH_YEARS) ?? null;
  const sources = TECHNOLOGIES.flatMap((tech) => {
    const mw = latest.mw[tech];
    return mw === undefined ? [] : [{ tech, mw, before: earlier ? (earlier.mw[tech] ?? 0) : null }];
  }).sort((a, b) => b.mw - a.mw);
  return { latest, earlier, sources, years: [...years].reverse() };
}
