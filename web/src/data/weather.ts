/**
 * "Near me" (Faza 19): current weather and last year's sunshine for a location from Open-Meteo (CC BY 4.0,
 * free for non-commercial use), and two rough solar estimates built on them. The location is rounded to two
 * decimals (about a kilometre) before it leaves the browser and is never stored.
 */
import { z } from "zod";

import { DataError } from "./current";
import { WEATHER_ORIGINS } from "./weatherOrigins";

/** Share of the sunshine a typical rooftop system turns into electricity (losses, heat, inverter). */
export const PERFORMANCE_RATIO = 0.8;
/** Gain of a panel at a good tilt over a flat one at this latitude (about 12 %). */
export const TILT_GAIN = 1.12;
/** Fewer reported days than this and the yearly sum is not trusted. */
export const MIN_DAYS = 300;

export const roundCoord = (value: number): number => Math.round(value * 100) / 100;

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

export function currentUrl(lat: number, lon: number): string {
  return `${WEATHER_ORIGINS[0]}/v1/forecast?latitude=${roundCoord(lat)}&longitude=${roundCoord(lon)}&current=cloud_cover,shortwave_radiation,is_day&timezone=auto`;
}

/** The last 365 complete days the archive has (it runs about a week behind). */
export function archiveUrl(lat: number, lon: number, today: Date): string {
  const end = new Date(today.getTime() - 8 * 86_400_000);
  const start = new Date(end.getTime() - 364 * 86_400_000);
  return `${WEATHER_ORIGINS[1]}/v1/archive?latitude=${roundCoord(lat)}&longitude=${roundCoord(lon)}&start_date=${isoDay(start)}&end_date=${isoDay(end)}&daily=shortwave_radiation_sum&timezone=auto`;
}

const CurrentSchema = z.object({
  current: z.object({
    time: z.string(),
    cloud_cover: z.number().min(0).max(100),
    shortwave_radiation: z.number().min(0),
    is_day: z.number(),
  }),
});
export interface Weather {
  time: string;
  cloudCover: number;
  /** global horizontal irradiance now, W/m² */
  radiation: number;
  day: boolean;
}

const ArchiveSchema = z.object({
  daily: z.object({ time: z.array(z.string()), shortwave_radiation_sum: z.array(z.number().nullable()) }),
});

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new DataError(`weather service returned HTTP ${response.status}`);
  return response.json();
}

export async function loadWeather(lat: number, lon: number, signal: AbortSignal): Promise<Weather> {
  const { current } = CurrentSchema.parse(await getJson(currentUrl(lat, lon), signal));
  return {
    time: current.time,
    cloudCover: current.cloud_cover,
    radiation: current.shortwave_radiation,
    day: current.is_day === 1,
  };
}

/** Sunshine over a year on a flat surface, kWh/m², scaled up for a few missing days; null if too few. */
export function yearlyIrradiation(dailyMj: readonly (number | null)[]): number | null {
  const days = dailyMj.filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0);
  if (days.length < MIN_DAYS) return null;
  const kwh = days.reduce((sum, mj) => sum + mj / 3.6, 0);
  return (kwh * 365) / days.length;
}

export async function loadYearlyIrradiation(
  lat: number,
  lon: number,
  today: Date,
  signal: AbortSignal,
): Promise<number | null> {
  const { daily } = ArchiveSchema.parse(await getJson(archiveUrl(lat, lon, today), signal));
  return yearlyIrradiation(daily.shortwave_radiation_sum);
}

/** What a system of `kwp` delivers now, kW: rough, flat-surface sunshine. */
export const solarNowKw = (kwp: number, radiation: number): number =>
  (kwp * radiation * PERFORMANCE_RATIO) / 1000;

/** Yearly yield per kWp installed, kWh: rough, no shading and no roof orientation. */
export const yieldPerKwp = (irradiation: number): number => irradiation * PERFORMANCE_RATIO * TILT_GAIN;
