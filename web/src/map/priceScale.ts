/**
 * Colours for day-ahead prices on the map and in the live bar's legend (Faza 18-2). Pure: the stops come
 * from the palette, so both themes and the legend use one scale.
 */
import type { ExpressionSpecification } from "maplibre-gl";

import type { CountryCode } from "../domain";
import type { Palette } from "./palette";

export type PriceStops = Palette["price"]["stops"];

/** The legend runs over this range; prices beyond it take the end colours. */
export const PRICE_LEGEND_RANGE = [-50, 250] as const;
export const PRICE_LEGEND_TICKS = [-50, 0, 100, 200] as const;

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`price scale: not a #rrggbb colour: ${hex}`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: readonly number[]): string =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** The colour for a price: linear between the two stops around it, clamped at the ends. */
export function priceColor(eur: number, stops: PriceStops): string {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) throw new Error("price scale: no stops");
  if (!Number.isFinite(eur) || eur <= first[0]) return first[1].toUpperCase();
  if (eur >= last[0]) return last[1].toUpperCase();
  for (let i = 1; i < stops.length; i++) {
    const lo = stops[i - 1];
    const hi = stops[i];
    if (!lo || !hi || eur > hi[0]) continue;
    const t = (eur - lo[0]) / (hi[0] - lo[0]);
    const a = rgb(lo[1]);
    const b = rgb(hi[1]);
    return toHex(a.map((v, k) => v + ((b[k] ?? v) - v) * t));
  }
  return last[1].toUpperCase();
}

/**
 * The fill of the `countries` layer for one hour: each country with a price gets its colour, every other
 * country none. A country without a price is never painted as if it had one. Null when nothing has a price.
 */
export function priceFill(
  prices: Partial<Record<CountryCode, number>>,
  stops: PriceStops,
): ExpressionSpecification | null {
  const pairs = Object.entries(prices).map(([code, eur]): [string, string] => [code, priceColor(eur, stops)]);
  // a match expression needs at least one label and colour before the fallback
  const [first, ...rest] = pairs;
  if (first === undefined) return null;
  return ["match", ["get", "code"], first[0], first[1], ...rest.flat(), "rgba(0, 0, 0, 0)"];
}

/** CSS gradient for the legend, with every stop at its place on the legend's range. */
export function priceGradient(stops: PriceStops): string {
  const [lo, hi] = PRICE_LEGEND_RANGE;
  const at = (eur: number): string => `${(((eur - lo) / (hi - lo)) * 100).toFixed(1)}%`;
  return `linear-gradient(90deg, ${stops.map(([eur, color]) => `${color} ${at(Math.min(hi, Math.max(lo, eur)))}`).join(", ")})`;
}

/** Where a tick sits on the legend, as a share of its width. */
export const priceTickAt = (eur: number): number =>
  (eur - PRICE_LEGEND_RANGE[0]) / (PRICE_LEGEND_RANGE[1] - PRICE_LEGEND_RANGE[0]);
