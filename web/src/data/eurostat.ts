/**
 * The official share of energy from renewable sources (Faza 28, pipeline/src/energymap/eurostat): Eurostat's
 * `nrg_ind_ren` for the eight countries and the EU, by year. Shares are percentages as Eurostat gives them
 * (34.123 means 34.123 %), aligned with `years`, `null` where a year has no value. Flags mark a value as
 * provisional (`p`), estimated (`e`), a break in the series (`b`) and so on.
 */
import { z } from "zod";

import { DataError } from "./current";

export const RENEWABLES_KEY = "eurostat/renewables.json";
export const RES_INDICATORS = ["REN", "REN_ELC", "REN_HEAT_CL", "REN_TRA"] as const;
export type ResIndicator = (typeof RES_INDICATORS)[number];
/** Eurostat's code for the EU of 27 members (since 2020). */
export const EU_AREA = "EU27_2020";
/** Croatia's 2030 target in the updated NECP: renewable share of gross final energy consumption, in percent. */
export const RES_TARGET_2030 = 42.5;

export const RenewablesSchema = z.object({
  version: z.literal(1),
  dataset: z.literal("nrg_ind_ren"),
  source: z.string(),
  sourceUrl: z.url(),
  license: z.string(),
  /** Eurostat's last update of the dataset, ISO 8601 */
  updated: z.string().nullable(),
  retrievedAt: z.string(),
  indicators: z.array(z.string()),
  years: z.array(z.number().int()).min(1),
  /** area → indicator → one share per year */
  series: z.record(z.string(), z.record(z.string(), z.array(z.number().nullable()))),
  /** area → indicator → year → flag */
  flags: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.string()))),
  /** Eurostat's own (English) words for the flags in use */
  flagLabels: z.record(z.string(), z.string()),
  /** areas asked for that Eurostat had no values for */
  missing: z.array(z.string()),
  contentHash: z.string(),
});
export type Renewables = z.infer<typeof RenewablesSchema>;

/** Every series must have one value per year, or the years would shift against the values. */
export function checkedRenewables(doc: Renewables): Renewables {
  for (const [area, byIndicator] of Object.entries(doc.series)) {
    for (const [indicator, values] of Object.entries(byIndicator)) {
      if (values.length !== doc.years.length) {
        throw new DataError(`renewable shares: ${area} ${indicator} does not have one value per year`);
      }
    }
  }
  return doc;
}

export interface Share {
  year: number;
  /** percent */
  value: number;
  flag: string | null;
}

function shareIn(doc: Renewables, area: string, indicator: ResIndicator, index: number): Share | null {
  const value = doc.series[area]?.[indicator]?.[index];
  const year = doc.years[index];
  if (value == null || year === undefined) return null;
  return { year, value, flag: doc.flags[area]?.[indicator]?.[String(year)] ?? null };
}

/** One area's share in one year, or null. */
export function shareAt(doc: Renewables, area: string, indicator: ResIndicator, year: number): Share | null {
  return shareIn(doc, area, indicator, year - (doc.years[0] ?? year));
}

/**
 * The latest share in `year` or before it (all years when `year` is left out): for comparing areas when some
 * report a year later.
 */
export function latestShare(
  doc: Renewables,
  area: string,
  indicator: ResIndicator,
  year = Infinity,
): Share | null {
  for (let index = doc.years.length - 1; index >= 0; index--) {
    if ((doc.years[index] ?? Infinity) > year) continue;
    const share = shareIn(doc, area, indicator, index);
    if (share) return share;
  }
  return null;
}
