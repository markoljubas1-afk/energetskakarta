/** Per-country totals from `stats.json` (pipeline/src/energymap/products.py). */
import { z } from "zod";

import {
  isOneOf,
  STATUSES,
  TECHNOLOGIES,
  VOLTAGE_CLASSES,
  type CountryCode,
  type Technology,
  type VoltageClass,
} from "../domain";

const PlantBucket = z.object({
  count: z.number().int(),
  capacityMw: z.number(),
  withCapacity: z.number().int(),
});

export const StatsSchema = z.object({
  version: z.literal(1),
  voltageClasses: z.array(z.string()),
  note: z.string(),
  plants: z.record(z.string(), z.record(z.string(), z.record(z.string(), PlantBucket))),
  substations: z.record(z.string(), z.record(z.string(), z.number())),
  lineKm: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.number()))),
  /** absent in builds made before data centres were added */
  datacenters: z
    .record(
      z.string(),
      z.record(
        z.string(),
        z.object({ count: z.number().int(), powerMw: z.number(), withPower: z.number().int() }),
      ),
    )
    .optional(),
});
export type Stats = z.infer<typeof StatsSchema>;

export interface TechnologyTotal {
  technology: Technology;
  operatingMw: number;
  pipelineMw: number;
  /** every status: operating, under construction, planned */
  plants: number;
  /** operating only, to stand next to `operatingMw` */
  operatingPlants: number;
  plantsWithoutCapacity: number;
}

export interface CountrySummary {
  technologies: TechnologyTotal[];
  operatingMw: number;
  pipelineMw: number;
  lineKm: { voltage: VoltageClass; km: number }[];
  substations: number;
  /** Data centres: how many, and the published power of those that state one. */
  datacenters: { count: number; powerMw: number; withPower: number };
}

/** Aggregate one country, or all given countries when `country` is "ALL". */
export function summarize(
  stats: Stats,
  country: CountryCode | "ALL",
  all: readonly CountryCode[],
): CountrySummary {
  const codes = country === "ALL" ? all : [country];
  const tech = new Map<Technology, TechnologyTotal>();
  const km = new Map<VoltageClass, number>();
  let substations = 0;
  const centres = { count: 0, powerMw: 0, withPower: 0 };

  for (const code of codes) {
    for (const [rawTech, byStatus] of Object.entries(stats.plants[code] ?? {})) {
      const technology = isOneOf(TECHNOLOGIES, rawTech) ? rawTech : "other";
      const total = tech.get(technology) ?? {
        technology,
        operatingMw: 0,
        pipelineMw: 0,
        plants: 0,
        operatingPlants: 0,
        plantsWithoutCapacity: 0,
      };
      for (const [status, bucket] of Object.entries(byStatus)) {
        if (!isOneOf(STATUSES, status)) continue;
        if (status === "operating") {
          total.operatingMw += bucket.capacityMw;
          total.operatingPlants += bucket.count;
        } else total.pipelineMw += bucket.capacityMw;
        total.plants += bucket.count;
        total.plantsWithoutCapacity += bucket.count - bucket.withCapacity;
      }
      tech.set(technology, total);
    }
    for (const [klass, byStatus] of Object.entries(stats.lineKm[code] ?? {})) {
      if (!isOneOf(VOLTAGE_CLASSES, klass)) continue;
      km.set(klass, (km.get(klass) ?? 0) + (byStatus.operating ?? 0));
    }
    for (const count of Object.values(stats.substations[code] ?? {})) substations += count;
    for (const bucket of Object.values(stats.datacenters?.[code] ?? {})) {
      centres.count += bucket.count;
      centres.powerMw += bucket.powerMw;
      centres.withPower += bucket.withPower;
    }
  }

  const technologies = [...tech.values()].sort(
    (a, b) => b.operatingMw - a.operatingMw || b.pipelineMw - a.pipelineMw || b.plants - a.plants,
  );
  return {
    technologies,
    operatingMw: technologies.reduce((sum, t) => sum + t.operatingMw, 0),
    pipelineMw: technologies.reduce((sum, t) => sum + t.pipelineMw, 0),
    lineKm: VOLTAGE_CLASSES.filter((v) => (km.get(v) ?? 0) > 0).map((voltage) => ({
      voltage,
      km: km.get(voltage) ?? 0,
    })),
    substations,
    datacenters: centres,
  };
}

export interface StatusTotal {
  plants: number;
  lineKm: number;
}

/**
 * How many plants and how many kilometres of line there are in each status, in the given countries (all of
 * them when none is chosen). The filter's status switches say it, because "under construction" and "planned"
 * are a tiny part of the map and switching them looks as if nothing happened.
 */
export function statusTotals(
  stats: Stats,
  countries: ReadonlySet<CountryCode>,
): Record<(typeof STATUSES)[number], StatusTotal> {
  const totals = Object.fromEntries(STATUSES.map((status) => [status, { plants: 0, lineKm: 0 }])) as Record<
    (typeof STATUSES)[number],
    StatusTotal
  >;
  const wanted = (code: string): boolean => countries.size === 0 || countries.has(code as CountryCode);
  for (const [code, byTechnology] of Object.entries(stats.plants)) {
    if (!wanted(code)) continue;
    for (const byStatus of Object.values(byTechnology)) {
      for (const [status, bucket] of Object.entries(byStatus)) {
        if (isOneOf(STATUSES, status)) totals[status].plants += bucket.count;
      }
    }
  }
  for (const [code, byClass] of Object.entries(stats.lineKm)) {
    if (!wanted(code)) continue;
    for (const byStatus of Object.values(byClass)) {
      for (const [status, km] of Object.entries(byStatus)) {
        if (isOneOf(STATUSES, status)) totals[status].lineKm += km;
      }
    }
  }
  return totals;
}
