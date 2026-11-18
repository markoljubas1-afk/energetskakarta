/**
 * Gas in storage at the end of each month, by country (pipeline/src/energymap/gas/storage_months.py, from
 * GIE AGSI): how full the country's storage was on the last gas day of the month that it reported.
 *
 * "The end of the month" is taken at its word here: a month whose last reported day is more than a couple
 * of days before its end (the month under way, or a month with a gap) is not a month-end, and is not used.
 * GIE asks to be named as the source wherever the figures are shown.
 */
import { z } from "zod";

const MonthEndSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** percent of the working volume */
  full: z.number().min(0).max(120),
  facilities: z.number().int().positive(),
});

export const StorageMonthsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  sourceUrl: z.url(),
  attribution: z.string().min(1),
  license: z.string(),
  countries: z.record(
    z.string(),
    z.object({ months: z.record(z.string().regex(/^\d{4}-\d{2}$/), MonthEndSchema) }),
  ),
});
export type StorageMonths = z.infer<typeof StorageMonthsSchema>;
export type MonthEnd = z.infer<typeof MonthEndSchema>;

export const STORAGE_MONTHS_KEY = "gas/storage-months.json";

/** A month's last reported day may be this many days before the month's last day and still be its end. */
export const END_SLACK_DAYS = 2;

/** The number of days in "2026-10". */
function daysIn(month: string): number {
  const [year = 0, number = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

/** A country's fill at the end of `month`; null when it has none, or its last day is not the month's end. */
export function monthEnd(
  storage: StorageMonths | null | undefined,
  country: string,
  month: string,
): MonthEnd | null {
  const found = storage?.countries[country]?.months[month];
  if (!found) return null;
  return Number(found.day.slice(8)) >= daysIn(month) - END_SLACK_DAYS ? found : null;
}
