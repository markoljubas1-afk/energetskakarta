/**
 * The time machine's data (pipeline/src/energymap/timeline.py, Faza 18-3): capacity in operation by year per
 * country and technology, how much has no commissioning year, and retired plants with their years.
 * Pure helpers turn it into the time bar's figures and the outlines drawn on the map.
 */
import type { Feature, FeatureCollection, Point } from "geojson";
import { z } from "zod";

import { isOneOf, SCOPE_COUNTRIES, TECHNOLOGIES, type CountryCode, type Technology } from "../domain";
import { assetUrl, DataError } from "./current";

const Retired = z.object({
  id: z.string(),
  name: z.string(),
  technology: z.string(),
  country: z.string(),
  capacityMw: z.number().nonnegative(),
  commissioningYear: z.number().int(),
  retiredYear: z.number().int(),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

export const TimelineSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  firstYear: z.number().int(),
  lastYear: z.number().int(),
  series: z.record(z.string(), z.record(z.string(), z.array(z.number()))),
  undated: z.record(z.string(), z.object({ plants: z.number().int().nonnegative(), mw: z.number() })),
  retired: z.array(Retired),
});
export type Timeline = z.infer<typeof TimelineSchema>;
export type RetiredPlant = z.infer<typeof Retired>;

export async function loadTimeline(base: URL, key: string, signal: AbortSignal): Promise<Timeline> {
  const response = await fetch(assetUrl(base, key), { signal });
  if (!response.ok) throw new DataError(`timeline returned HTTP ${response.status}`);
  const timeline = TimelineSchema.parse(await response.json());
  const length = timeline.lastYear - timeline.firstYear + 1;
  if (length < 1) throw new DataError("timeline ends before it starts");
  for (const techs of Object.values(timeline.series))
    for (const values of Object.values(techs))
      if (values.length !== length) throw new DataError("timeline columns do not match its years");
  return timeline;
}

/** Which countries and technologies the figures cover: the map's own filters (empty countries = all). */
export interface TimelineScope {
  countries: ReadonlySet<CountryCode>;
  technologies: ReadonlySet<Technology>;
}

const countriesIn = (scope: TimelineScope): readonly CountryCode[] =>
  scope.countries.size === 0 ? SCOPE_COUNTRIES : SCOPE_COUNTRIES.filter((c) => scope.countries.has(c));

export const clampYear = (timeline: Timeline, year: number): number =>
  Math.min(timeline.lastYear, Math.max(timeline.firstYear, Math.round(year)));

/**
 * MW in operation per technology for every year of the timeline, summed over the scope; only technologies
 * that ever have capacity, in the canonical order (which is also the stacking order of the chart).
 */
export function stackedSeries(
  timeline: Timeline,
  scope: TimelineScope,
): { technology: Technology; mw: number[] }[] {
  const length = timeline.lastYear - timeline.firstYear + 1;
  return TECHNOLOGIES.filter((t) => scope.technologies.has(t)).flatMap((technology) => {
    const mw = new Array<number>(length).fill(0);
    for (const country of countriesIn(scope)) {
      const values = timeline.series[country]?.[technology];
      if (values) values.forEach((v, i) => (mw[i] = (mw[i] ?? 0) + v));
    }
    return mw.some((v) => v > 0) ? [{ technology, mw }] : [];
  });
}

export interface YearSummary {
  /** MW in operation that year, over the scope */
  operatingMw: number;
  /** retired plants that had stopped by then (shown as outlines) */
  closedPlants: number;
  closedMw: number;
  /** the latest closure up to that year, for the bar's one-line story */
  lastClosure: RetiredPlant | null;
  /** today's plants the timeline cannot place (no year or no capacity) */
  undatedPlants: number;
}

export function summarize(timeline: Timeline, scope: TimelineScope, year: number): YearSummary {
  const index = clampYear(timeline, year) - timeline.firstYear;
  const operatingMw = stackedSeries(timeline, scope).reduce((sum, row) => sum + (row.mw[index] ?? 0), 0);
  const countries = new Set(countriesIn(scope));
  const closed = timeline.retired
    .filter((p) => inScope(p, countries, scope) && p.retiredYear <= year)
    .sort((a, b) => a.retiredYear - b.retiredYear || b.capacityMw - a.capacityMw);
  const undatedPlants = [...countries].reduce((sum, c) => sum + (timeline.undated[c]?.plants ?? 0), 0);
  return {
    operatingMw,
    closedPlants: closed.length,
    closedMw: closed.reduce((sum, p) => sum + p.capacityMw, 0),
    lastClosure: closed.at(-1) ?? null,
    undatedPlants,
  };
}

function inScope(plant: RetiredPlant, countries: ReadonlySet<string>, scope: TimelineScope): boolean {
  return (
    countries.has(plant.country) &&
    isOneOf(TECHNOLOGIES, plant.technology) &&
    scope.technologies.has(plant.technology)
  );
}

/**
 * Retired plants on the map for a year: running ones look like any plant ("running"), closed ones are
 * outlines ("closed"), and those not yet built are left out.
 */
export function retiredFeatures(
  timeline: Timeline,
  scope: TimelineScope,
  year: number,
): FeatureCollection<Point> {
  const countries = new Set(countriesIn(scope));
  const features: Feature<Point>[] = timeline.retired
    .filter((p) => inScope(p, countries, scope) && p.commissioningYear <= year)
    .map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id,
        name: p.name,
        technology: p.technology,
        capacityMw: p.capacityMw,
        commissioningYear: p.commissioningYear,
        retiredYear: p.retiredYear,
        phase: p.retiredYear <= year ? "closed" : "running",
      },
    }));
  return { type: "FeatureCollection", features };
}
