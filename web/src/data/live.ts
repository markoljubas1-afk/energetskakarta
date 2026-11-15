/**
 * Hourly cross-border flows and day-ahead prices (pipeline/src/energymap/entsoe/live.py).
 * An hour without a value has no arrow and no number: a gap is never drawn as zero.
 */
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";
import { z } from "zod";

import { SCOPE_COUNTRIES, type CountryCode } from "../domain";
import { assetUrl, DataError } from "./current";

export const LiveSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  timezone: z.string(),
  hours: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:00/)),
  flows: z.array(z.object({ from: z.string(), to: z.string(), mw: z.array(z.number().nullable()) })),
  prices: z.record(z.string(), z.object({ zone: z.string(), eurPerMwh: z.array(z.number().nullable()) })),
  /** actual generation, MW per technology per hour (Faza 19); an hour a country did not fully report is null */
  generation: z.record(z.string(), z.record(z.string(), z.array(z.number().nullable()))).optional(),
  missing: z.object({
    flows: z.array(z.string()),
    prices: z.array(z.string()),
    generation: z.array(z.string()).optional(),
  }),
  /** set only on synthetic development data */
  fixture: z.string().optional(),
});
export type Live = z.infer<typeof LiveSchema>;

export type LiveLoad = { kind: "none" } | { kind: "ready"; live: Live };

export async function loadLive(base: URL, signal: AbortSignal): Promise<LiveLoad> {
  const url = `${assetUrl(base, "live/current.json")}?t=${Math.floor(Date.now() / 300_000)}`;
  const response = await fetch(url, { signal });
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) throw new DataError(`live data returned HTTP ${response.status}`);
  const live = LiveSchema.parse(await response.json());
  const n = live.hours.length;
  const bad =
    live.flows.some((f) => f.mw.length !== n) ||
    Object.values(live.prices).some((p) => p.eurPerMwh.length !== n) ||
    Object.values(live.generation ?? {}).some((techs) => Object.values(techs).some((v) => v.length !== n));
  if (bad) throw new DataError("live data columns do not match its hours");
  return { kind: "ready", live };
}

/** Points inside each country that arrows start and end at (as in the approved prototype). */
export const COUNTRY_ANCHORS: Record<CountryCode, [number, number]> = {
  HR: [16.3, 45.45],
  SI: [14.5, 46.25],
  HU: [19.2, 47.1],
  RS: [20.8, 44.0],
  BA: [17.8, 44.2],
  ME: [19.2, 42.8],
  IT: [12.4, 42.9],
  AT: [14.6, 47.55],
};

/** Which price zone stands for a country on the map; Italy's northern zone borders the region. */
export const COUNTRY_PRICE_ZONE: Record<CountryCode, string> = {
  HR: "HR",
  SI: "SI",
  HU: "HU",
  RS: "RS",
  BA: "BA",
  ME: "ME",
  AT: "AT",
  IT: "IT_NORD",
};

/**
 * "2026-09-16T13+02": the local hour and its UTC offset, used in links. The offset keeps the two
 * 02:00 hours of the day the clocks go back apart.
 */
export const hourKey = (iso: string): string => `${iso.slice(0, 13)}${iso.slice(-6, -3)}`;

/** The hour to show: the one in the link, else the hour containing `now`, else the last hour. */
export function pickHour(live: Live, wanted: string | null, now: Date): number {
  if (wanted) {
    // exact key first; links made before offsets were added carry only the local hour
    const exact = live.hours.findIndex((h) => hourKey(h) === wanted);
    const legacy = live.hours.findIndex((h) => h.slice(0, 13) === wanted);
    const index = exact >= 0 ? exact : legacy;
    if (index >= 0) return index;
  }
  const t = now.getTime();
  const index = live.hours.findIndex((h) => {
    const start = Date.parse(h);
    return t >= start && t < start + 3_600_000;
  });
  return index >= 0 ? index : live.hours.length - 1;
}

/** Day relative to the document's middle day ("yesterday", "today", "tomorrow"). */
export function dayOf(live: Live, index: number): -1 | 0 | 1 {
  const days = [...new Set(live.hours.map((h) => h.slice(0, 10)))];
  const day = live.hours[index]?.slice(0, 10) ?? "";
  const position = days.indexOf(day) - 1;
  return position < 0 ? -1 : position > 0 ? 1 : 0;
}

const isCountry = (code: string): code is CountryCode =>
  (SCOPE_COUNTRIES as readonly string[]).includes(code);

type Point = [number, number];
const bezier = (a: Point, c: Point, b: Point, t: number): Point => [
  (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t ** 2 * b[0],
  (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t ** 2 * b[1],
];

/** A bowed arc from `from` to `to`. The bow side is fixed per border, so a reversal keeps the same arc. */
export function arc(from: Point, to: Point, reversed: boolean, steps = 24): Point[] {
  // Always built from → to, so the bow is on the same side whichever way the power flows;
  // a reversed flow walks the same points backwards.
  const control: Point = [
    (from[0] + to[0]) / 2 - (to[1] - from[1]) * 0.18,
    (from[1] + to[1]) / 2 + (to[0] - from[0]) * 0.18,
  ];
  const points = Array.from({ length: steps + 1 }, (_, i) => bezier(from, control, to, i / steps));
  return reversed ? points.reverse() : points;
}

function arrowhead(line: Point[], size: number): Point[] {
  const i = Math.round(line.length * 0.58);
  const tip = line[i] ?? line[line.length - 1];
  const back = line[i - 1] ?? line[0];
  if (!tip || !back) return [];
  const length = Math.hypot(tip[0] - back[0], tip[1] - back[1]) || 1;
  const d: Point = [(tip[0] - back[0]) / length, (tip[1] - back[1]) / length];
  const n: Point = [-d[1], d[0]];
  const front: Point = [tip[0] + d[0] * size, tip[1] + d[1] * size];
  const left: Point = [tip[0] + n[0] * size * 0.6, tip[1] + n[1] * size * 0.6];
  const right: Point = [tip[0] - n[0] * size * 0.6, tip[1] - n[1] * size * 0.6];
  return [front, left, right, front];
}

export interface LiveLabel {
  key: string;
  lng: number;
  lat: number;
  kind: "flow" | "price";
  mw?: number;
  eur?: number;
  from?: CountryCode;
  to?: CountryCode;
  country?: CountryCode;
}

export interface LiveOverlay {
  features: FeatureCollection<LineString | Polygon>;
  labels: LiveLabel[];
  /** EUR/MWh at the hour, only for countries that have a price then (the map fills those; Faza 18-2) */
  prices: Partial<Record<CountryCode, number>>;
}

export interface FlowRow {
  from: CountryCode;
  to: CountryCode;
  /** positive MW in the direction from → to */
  mw: number | null;
}

/** Net flows at an hour, oriented in the direction the power actually goes. */
export function flowsAt(live: Live, index: number): FlowRow[] {
  return live.flows.flatMap((flow) => {
    if (!isCountry(flow.from) || !isCountry(flow.to)) return [];
    const value = flow.mw[index] ?? null;
    if (value !== null && value < 0) return [{ from: flow.to, to: flow.from, mw: -value }];
    return [{ from: flow.from, to: flow.to, mw: value }];
  });
}

export interface PriceRow {
  country: CountryCode;
  zone: string;
  eur: number | null;
}

export function pricesAt(live: Live, index: number): PriceRow[] {
  return SCOPE_COUNTRIES.flatMap((country) => {
    const zone = COUNTRY_PRICE_ZONE[country];
    const series = live.prices[zone];
    if (!series) return [];
    return [{ country, zone, eur: series.eurPerMwh[index] ?? null }];
  });
}

export function overlay(live: Live, index: number): LiveOverlay {
  const features: Feature<LineString | Polygon>[] = [];
  const labels: LiveLabel[] = [];
  const prices: Partial<Record<CountryCode, number>> = {};
  for (const flow of live.flows) {
    if (!isCountry(flow.from) || !isCountry(flow.to)) continue;
    const value = flow.mw[index];
    if (value === null || value === undefined) continue;
    const reversed = value < 0;
    const line = arc(COUNTRY_ANCHORS[flow.from], COUNTRY_ANCHORS[flow.to], reversed);
    const mw = Math.abs(value);
    const [from, to] = reversed ? [flow.to, flow.from] : [flow.from, flow.to];
    const properties = { mw, from, to };
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties });
    if (mw > 0) {
      const head = arrowhead(line, 0.16);
      if (head.length)
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [head] }, properties });
    }
    const middle = line[Math.round(line.length / 2)];
    if (middle)
      labels.push({
        key: `flow-${flow.from}-${flow.to}`,
        lng: middle[0],
        lat: middle[1],
        kind: "flow",
        mw,
        from,
        to,
      });
  }
  for (const price of pricesAt(live, index)) {
    if (price.eur === null) continue;
    prices[price.country] = price.eur;
    const [lng, lat] = COUNTRY_ANCHORS[price.country];
    labels.push({
      key: `price-${price.country}`,
      lng,
      lat,
      kind: "price",
      eur: price.eur,
      country: price.country,
    });
  }
  return { features: { type: "FeatureCollection", features }, labels, prices };
}
