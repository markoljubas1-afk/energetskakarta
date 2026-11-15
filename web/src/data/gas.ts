/**
 * Daily gas production entering the grid at ENTSOG production points (pipeline/src/energymap/gas/entsog.py).
 *
 * The platform aggregates domestic production per transmission operator, so there is one figure per
 * country per gas day and no coordinates: the map shows a disc at the country's anchor, sized by the
 * latest day. A day without a value is a gap, never a zero.
 */
import type { Feature, FeatureCollection, Point } from "geojson";
import { z } from "zod";

import { isOneOf, SCOPE_COUNTRIES, type CountryCode } from "../domain";
import { assetUrl, DataError } from "./current";
import { COUNTRY_ANCHORS } from "./live";

export const GasSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  unit: z.literal("kWh/d"),
  days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  points: z.array(
    z.object({
      key: z.string(),
      pointDirection: z.string(),
      label: z.string(),
      country: z.string(),
      operator: z.string(),
      kwhPerDay: z.array(z.number().nullable()),
    }),
  ),
  missing: z.object({ points: z.array(z.string()), countries: z.array(z.string()) }),
  /** set only on synthetic development data */
  fixture: z.string().optional(),
});
export type Gas = z.infer<typeof GasSchema>;

export type GasLoad = { kind: "none" } | { kind: "ready"; gas: Gas };

export async function loadGas(base: URL, signal: AbortSignal): Promise<GasLoad> {
  const url = `${assetUrl(base, "live/gas.json")}?t=${Math.floor(Date.now() / 3_600_000)}`;
  const response = await fetch(url, { signal });
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) throw new DataError(`gas data returned HTTP ${response.status}`);
  const gas = GasSchema.parse(await response.json());
  if (gas.points.some((point) => point.kwhPerDay.length !== gas.days.length)) {
    throw new DataError("gas data columns do not match its days");
  }
  return { kind: "ready", gas };
}

/** One country's production: the points that feed it and their sum per day. */
export interface CountryGas {
  country: CountryCode;
  points: { label: string; operator: string }[];
  /** kWh per gas day, summed over the country's points; null when none of them reported */
  kwhPerDay: (number | null)[];
}

export function byCountry(gas: Gas): CountryGas[] {
  const grouped = new Map<CountryCode, CountryGas>();
  for (const point of gas.points) {
    if (!isOneOf(SCOPE_COUNTRIES, point.country)) continue;
    const entry = grouped.get(point.country) ?? {
      country: point.country,
      points: [],
      kwhPerDay: gas.days.map(() => null),
    };
    entry.points.push({ label: point.label, operator: point.operator });
    entry.kwhPerDay = entry.kwhPerDay.map((sum, i) => {
      const value = point.kwhPerDay[i] ?? null;
      if (value === null) return sum;
      return (sum ?? 0) + value;
    });
    grouped.set(point.country, entry);
  }
  return SCOPE_COUNTRIES.flatMap((code) => {
    const entry = grouped.get(code);
    return entry ? [entry] : [];
  });
}

/** The most recent day with a figure, or null when there is none. */
export function latest(kwhPerDay: readonly (number | null)[]): { index: number; kwh: number } | null {
  for (let index = kwhPerDay.length - 1; index >= 0; index -= 1) {
    const kwh = kwhPerDay[index];
    if (kwh !== null && kwh !== undefined) return { index, kwh };
  }
  return null;
}

/** The id a country's production is selected by: "gas:HR". */
export const gasId = (country: CountryCode): string => `gas:${country}`;

/** Below the live-price label of the same country, so both can be read when both layers are on. */
const ANCHOR_OFFSET_LAT = -0.55;

export interface GasProperties {
  id: string;
  country: CountryCode;
  /** kWh on the latest reported day; the disc's size */
  latestKwh: number;
  latestDay: string;
  days: string;
  kwhPerDay: string;
  points: string;
  generatedAt: string;
}

/** A point per country that has production, for the map source. Series travel as JSON strings, as the
 * cities' sectors do: MapLibre properties are scalars. */
export function gasOverlay(gas: Gas): FeatureCollection<Point, GasProperties> {
  const features: Feature<Point, GasProperties>[] = [];
  for (const entry of byCountry(gas)) {
    const last = latest(entry.kwhPerDay);
    if (!last) continue;
    const [lon, lat] = COUNTRY_ANCHORS[entry.country];
    features.push({
      type: "Feature",
      id: gasId(entry.country),
      geometry: { type: "Point", coordinates: [lon, lat + ANCHOR_OFFSET_LAT] },
      properties: {
        id: gasId(entry.country),
        country: entry.country,
        latestKwh: last.kwh,
        latestDay: gas.days[last.index] ?? "",
        days: JSON.stringify(gas.days),
        kwhPerDay: JSON.stringify(entry.kwhPerDay),
        points: JSON.stringify(entry.points),
        generatedAt: gas.generatedAt,
      },
    });
  }
  return { type: "FeatureCollection", features };
}
