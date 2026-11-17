/**
 * Gas in storage, per facility and gas day (pipeline/src/energymap/gas/agsi.py), from GIE's AGSI platform.
 * GIE lets the data be used and repackaged on one condition: that GIE (AGSI) is named as the source wherever
 * it is shown. Every view of it carries `attribution`.
 *
 * What the figures are: the operator's own report for a gas day (06:00 to 06:00 CET), published the evening
 * after; `status` says whether a day is confirmed (C) or estimated (E). What they are not: a measurement of
 * ours, or a statement about where the gas goes.
 */
import type { Feature, FeatureCollection, Point } from "geojson";
import { z } from "zod";

import { assetUrl, DataError } from "./current";

const Series = z.array(z.number().nullable());

export const GasStorageSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  sourceUrl: z.url(),
  attribution: z.string().min(1),
  license: z.string(),
  /** gas days, ascending */
  days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  facilities: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      operator: z.string(),
      operatorId: z.string(),
      country: z.string(),
      lon: z.number().nullable(),
      lat: z.number().nullable(),
      /** what the facility can hold, TWh */
      workingGasTwh: z.number().nullable(),
      /** the platform's mark for each day: E estimated, C confirmed, N no data; null: not reported */
      status: z.array(z.string().nullable()),
      fullPercent: Series,
      inStorageTwh: Series,
      injectionGwhPerDay: Series,
      withdrawalGwhPerDay: Series,
    }),
  ),
  missing: z.object({ facilities: z.array(z.string()), countries: z.array(z.string()) }),
});
export type GasStorage = z.infer<typeof GasStorageSchema>;
export type Facility = GasStorage["facilities"][number];

export type GasStorageLoad = { kind: "none" } | { kind: "ready"; storage: GasStorage };

export const GAS_STORAGE_KEY = "live/gasstorage.json";

export async function loadGasStorage(base: URL, signal: AbortSignal): Promise<GasStorageLoad> {
  const url = `${assetUrl(base, GAS_STORAGE_KEY)}?t=${Math.floor(Date.now() / 3_600_000)}`;
  const response = await fetch(url, { signal });
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) throw new DataError(`gas storage returned HTTP ${response.status}`);
  const storage = GasStorageSchema.parse(await response.json());
  const columns = [
    "status",
    "fullPercent",
    "inStorageTwh",
    "injectionGwhPerDay",
    "withdrawalGwhPerDay",
  ] as const;
  for (const facility of storage.facilities) {
    if (columns.some((column) => facility[column].length !== storage.days.length)) {
      throw new DataError(`gas storage: ${facility.id} does not have one value per day`);
    }
  }
  return { kind: "ready", storage };
}

export type Direction = "injecting" | "withdrawing" | "steady";

export interface Reading {
  facility: Facility;
  /** the last gas day the facility reported */
  day: string;
  /** percent of the working volume */
  full: number;
  inStorageTwh: number | null;
  injection: number | null;
  withdrawal: number | null;
  direction: Direction;
  /** the platform's mark for that day: estimated rather than confirmed */
  estimated: boolean;
  /** how the fill changed against the day before in the data, in percentage points; null: no day before */
  change: number | null;
  /** the fill on every day the facility reported, oldest first, for the small curve of the last weeks */
  history: { day: string; full: number }[];
}

/** A facility's last reported day; null when it reported no fill at all. */
export function latestReading(storage: GasStorage, facility: Facility): Reading | null {
  for (let index = storage.days.length - 1; index >= 0; index -= 1) {
    const full = facility.fullPercent[index];
    const day = storage.days[index];
    if (full == null || day === undefined) continue;
    const injection = facility.injectionGwhPerDay[index] ?? null;
    const withdrawal = facility.withdrawalGwhPerDay[index] ?? null;
    const net = (injection ?? 0) - (withdrawal ?? 0);
    const before = index > 0 ? facility.fullPercent[index - 1] : null;
    return {
      facility,
      day,
      full,
      inStorageTwh: facility.inStorageTwh[index] ?? null,
      injection,
      withdrawal,
      direction: net > 0 ? "injecting" : net < 0 ? "withdrawing" : "steady",
      estimated: facility.status[index] === "E",
      change: before == null ? null : Math.round((full - before) * 100) / 100,
      history: storage.days.flatMap((each, at) => {
        const value = facility.fullPercent[at];
        return value == null ? [] : [{ day: each, full: value }];
      }),
    };
  }
  return null;
}

/** Every facility's last reading: the reader's country first (when given), then by country and name. */
export function readings(storage: GasStorage, first: string | null = null): Reading[] {
  return storage.facilities
    .map((facility) => latestReading(storage, facility))
    .filter((reading): reading is Reading => reading !== null)
    .sort((a, b) => {
      const rank = (reading: Reading): number => (reading.facility.country === first ? 0 : 1);
      return (
        rank(a) - rank(b) ||
        a.facility.country.localeCompare(b.facility.country) ||
        a.facility.name.localeCompare(b.facility.name)
      );
    });
}

export interface StorageProperties {
  id: string;
  name: string;
  /** percent of the working volume on the last reported day, rounded as shown */
  full: number;
}

/** The facilities AGSI gives a position for and that reported a fill, as points for the map. */
export function storageOverlay(storage: GasStorage): FeatureCollection<Point, StorageProperties> {
  const features = readings(storage).flatMap<Feature<Point, StorageProperties>>((reading) => {
    const { id, name, lon, lat } = reading.facility;
    if (lon === null || lat === null) return [];
    return [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { id, name, full: Math.round(reading.full) },
      },
    ];
  });
  return { type: "FeatureCollection", features };
}
