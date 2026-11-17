/**
 * What is usual for a country (pipeline/src/energymap/entsoe/usual.py): the middle half of its daily renewable
 * shares over the last 365 complete days. The green card's colour is the same fixed scale for every country;
 * this is the country's own yardstick, said in words next to it.
 *
 * The range is of daily shares; the card's figure is for one hour. An hour can sit outside a day's range for
 * no other reason than the time of day, so every sentence made from this says "daily share".
 */
import { z } from "zod";

import { assetUrl, DataError } from "./current";

const Share = z.number().min(0).max(1);

export const UsualSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  from: z.string(),
  to: z.string(),
  windowDays: z.number().int().positive(),
  countries: z.record(
    z.string(),
    z.object({ low: Share, median: Share, high: Share, days: z.number().int() }),
  ),
  missing: z.array(z.string()),
});
export type Usual = z.infer<typeof UsualSchema>;

export const USUAL_KEY = "live/usual.json";

/** The published document for the app; null when the bucket has none yet. */
export async function loadUsual(base: URL, signal: AbortSignal): Promise<Usual | null> {
  const response = await fetch(assetUrl(base, USUAL_KEY), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new DataError(`usual shares returned HTTP ${response.status}`);
  return UsualSchema.parse(await response.json());
}

export type Against = "above" | "within" | "below";

export interface UsualRange {
  low: number;
  high: number;
  /** where a share stands against the range, compared as whole percents (the way both are shown) */
  against: Against;
}

/** A country's usual range and where `share` stands against it; null without a yardstick for the country. */
export function usualFor(usual: Usual, country: string, share: number): UsualRange | null {
  const range = usual.countries[country];
  if (!range) return null;
  const percent = (value: number): number => Math.round(value * 100);
  const now = percent(share);
  const against: Against =
    now > percent(range.high) ? "above" : now < percent(range.low) ? "below" : "within";
  return { low: range.low, high: range.high, against };
}
