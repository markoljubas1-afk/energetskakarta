/**
 * "How green is the electricity right now" (Faza 36): the share of renewable sources in what a country's
 * own plants generated in an hour, from the same hourly figures the live layer shows (ENTSO-E, by way of
 * pipeline/src/energymap/entsoe/live.py).
 *
 * What the number is not: it says nothing about imports (the flows across the border carry no label of
 * what they were generated from) and nothing about demand, which the live data does not have. It is the
 * mix of domestic generation, and every text that shows it says so.
 */
import { isOneOf, TECHNOLOGIES, type Technology } from "../domain";
import type { Live } from "./live";

/**
 * Sources that renew themselves. Pumped storage is left out on purpose: what it generates was pumped up
 * with electricity from the grid, whatever that was made from. Nuclear is low-carbon but not renewable.
 */
export const RENEWABLE: readonly Technology[] = ["hydro", "wind", "solar", "biomass", "geothermal"];

/** Three bands of the share, fixed and stated wherever the band is shown (decision 2026-11-16). */
export const BAND_LIMITS = { mid: 0.35, high: 0.65 } as const;
export type Band = "low" | "mid" | "high";

export function band(share: number): Band {
  if (share >= BAND_LIMITS.high) return "high";
  return share >= BAND_LIMITS.mid ? "mid" : "low";
}

export interface Green {
  /** index into `live.hours` */
  index: number;
  /** the hour the figures are for, as the live data writes it */
  hour: string;
  /** renewable share of the country's own generation in that hour, 0 to 1 */
  share: number;
  totalMw: number;
  renewableMw: number;
  /** the technology that generated the most in that hour */
  top: { technology: Technology; mw: number };
}

/** The mix of one country in one hour; null when the country did not report that hour. */
export function greenAt(live: Live, country: string, index: number): Green | null {
  const hour = live.hours[index];
  const byTechnology = live.generation?.[country];
  if (hour === undefined || !byTechnology) return null;
  let total = 0;
  let renewable = 0;
  let top: Green["top"] | null = null;
  for (const [technology, values] of Object.entries(byTechnology)) {
    const mw = values[index];
    if (mw === null || mw === undefined || !isOneOf(TECHNOLOGIES, technology)) continue;
    total += mw;
    if (RENEWABLE.includes(technology)) renewable += mw;
    if (top === null || mw > top.mw) top = { technology, mw };
  }
  if (top === null || total <= 0) return null;
  return { index, hour, share: renewable / total, totalMw: total, renewableMw: renewable, top };
}

/** The latest hour, not after `now`, for which the country reported; null when there is none. */
export function latestGreen(live: Live, country: string, now: Date): Green | null {
  for (let index = live.hours.length - 1; index >= 0; index -= 1) {
    const hour = live.hours[index];
    if (hour === undefined || Date.parse(hour) > now.getTime()) continue;
    const green = greenAt(live, country, index);
    if (green) return green;
  }
  return null;
}

/**
 * How the share differs from the same hour a day earlier, in share points (0.1 = ten percentage points);
 * null when that hour is not in the data or was not reported.
 */
export function changeFromYesterday(live: Live, country: string, green: Green): number | null {
  const wanted = Date.parse(green.hour) - 24 * 3_600_000;
  // a day back is 24 entries back, except across a clock change: look for the hour itself
  const index = live.hours.findIndex((hour) => Date.parse(hour) === wanted);
  const before = index >= 0 ? greenAt(live, country, index) : null;
  return before ? green.share - before.share : null;
}

/** Generation figures arrive an hour or two after the hour itself; older than this is no longer "now". */
export const STALE_AFTER_HOURS = 4;

/** Whole hours from the end of the hour the figures are for until `now`. */
export function ageHours(green: Green, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - (Date.parse(green.hour) + 3_600_000)) / 3_600_000));
}

/** The countries the live data has generation for, in the data's own order. */
export function greenCountries(live: Live): string[] {
  return Object.keys(live.generation ?? {}).filter((country) =>
    live.hours.some((_, index) => greenAt(live, country, index) !== null),
  );
}

export interface MixPart {
  technology: Technology;
  /** share of the country's own generation in that hour, 0 to 1 */
  share: number;
}

/** What a country's plants generated in one hour, by technology, largest first; empty when not reported. */
export function mixAt(live: Live, country: string, index: number): MixPart[] {
  const green = greenAt(live, country, index);
  const byTechnology = live.generation?.[country];
  if (!green || !byTechnology) return [];
  const parts: MixPart[] = [];
  for (const [technology, values] of Object.entries(byTechnology)) {
    const mw = values[index];
    if (mw === null || mw === undefined || mw <= 0 || !isOneOf(TECHNOLOGIES, technology)) continue;
    parts.push({ technology, share: mw / green.totalMw });
  }
  return parts.sort((a, b) => b.share - a.share);
}

export interface NowMix {
  green: Green;
  parts: MixPart[];
}

/** The country's mix in its latest reported hour, or null when there is none or it is too old to be "now". */
export function mixNow(live: Live, country: string, now: Date): NowMix | null {
  const green = latestGreen(live, country, now);
  if (!green || ageHours(green, now) > STALE_AFTER_HOURS) return null;
  return { green, parts: mixAt(live, country, green.index) };
}

/** The band of every country whose latest hour is fresh; a country without one is simply absent. */
export function freshBands(live: Live, now: Date): Record<string, Band> {
  const bands: Record<string, Band> = {};
  for (const country of greenCountries(live)) {
    const mix = mixNow(live, country, now);
    if (mix) bands[country] = band(mix.green.share);
  }
  return bands;
}
