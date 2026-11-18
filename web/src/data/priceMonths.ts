/**
 * Monthly totals of the day-ahead price (pipeline/src/energymap/entsoe/prices.py): how many hours and days
 * of a month the exchange price was zero or below, the lowest hour and the average, for the home price zone.
 *
 * An hour is the mean of what the auction reported for it (15-minute products since 2025), as in the live
 * layer. A month says something only when every one of its hours has a price; the month under way is in
 * the document too, and is not a month yet.
 */
import { z } from "zod";

const MonthSchema = z.object({
  hours: z.number().int().positive(),
  reported: z.number().int().positive(),
  freeHours: z.number().int().min(0),
  freeDays: z.number().int().min(0),
  min: z.number(),
  minAt: z.string(),
  average: z.number(),
});

export const PriceMonthsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  timezone: z.string(),
  zones: z.record(
    z.string(),
    z.object({ zone: z.string(), months: z.record(z.string().regex(/^\d{4}-\d{2}$/), MonthSchema) }),
  ),
});
export type PriceMonths = z.infer<typeof PriceMonthsSchema>;
export type PriceMonth = z.infer<typeof MonthSchema>;

export const PRICE_MONTHS_KEY = "energy/prices.json";

/** A country's month, when every hour of it has a price; null otherwise (not published, or not over). */
export function priceMonth(
  prices: PriceMonths | null | undefined,
  country: string,
  month: string,
): PriceMonth | null {
  const found = prices?.zones[country]?.months[month];
  return found && found.reported === found.hours ? found : null;
}
