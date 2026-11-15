/**
 * Generation and load over time (pipeline/src/energymap/entsoe/store.py and release.py).
 *
 * Values are MWh per local day, month or year. A missing value is `null` and stays null here: gaps are
 * shown as gaps, never as zero. Coverage (0–1) says how much of a period the platform reported.
 */
import { z } from "zod";

import { isOneOf, TECHNOLOGIES, type Technology } from "../domain";
import { DataError } from "./current";

const Blob = z.object({ key: z.string().regex(/^energy\//), sha256: z.string(), bytes: z.number() });

export const EnergyPointerSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  unit: z.literal("MWh"),
  timezone: z.string(),
  countries: z.array(z.string()),
  years: z.record(z.string().regex(/^\d{4}$/), Blob),
  periods: Blob,
});
export type EnergyPointer = z.infer<typeof EnergyPointerSchema>;

const Column = z.array(z.number().nullable());
const Block = z.object({
  periods: z.array(z.string()),
  generation: z.record(z.string(), Column),
  consumption: z.record(z.string(), Column),
  load: Column,
  coverage: z.object({ generation: z.array(z.number()), load: z.array(z.number()) }),
});
export const PeriodsSchema = z.object({
  version: z.literal(1),
  unit: z.literal("MWh"),
  countries: z.record(z.string(), z.object({ months: Block, years: Block })),
});
export type Periods = z.infer<typeof PeriodsSchema>;

export const YearFileSchema = z.object({
  version: z.literal(1),
  year: z.number().int(),
  unit: z.literal("MWh"),
  days: z.array(z.string()),
  countries: z.record(
    z.string(),
    z.object({
      generation: z.record(z.string(), Column),
      consumption: z.record(z.string(), Column),
      load: Column,
      coverage: z.object({ generation: z.array(z.number()), load: z.array(z.number()) }),
    }),
  ),
});
export type YearFile = z.infer<typeof YearFileSchema>;

export type Unit = "month" | "year";
export type Area = string; // a country code, or "ALL"
export const ALL = "ALL";

export interface EnergySeries {
  periods: string[];
  generation: Partial<Record<Technology, (number | null)[]>>;
  pumping: (number | null)[];
  load: (number | null)[];
  coverage: number[];
  loadCoverage: number[];
  /** Countries included (for "ALL": every country with data). */
  countries: string[];
}

type Block = z.infer<typeof Block>;

function checkBlock(block: Block, where: string): void {
  const n = block.periods.length;
  const columns = [
    ...Object.values(block.generation),
    ...Object.values(block.consumption),
    block.load,
    block.coverage.generation,
    block.coverage.load,
  ];
  if (columns.some((column) => column.length !== n)) {
    throw new DataError(`${where}: columns do not match the ${n} periods`);
  }
}

const add = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a === null || a === undefined ? (b ?? null) : b === null || b === undefined ? a : a + b;

/**
 * One country, or the sum of all countries. A summed period is only as complete as its least complete
 * country (same rule as the pipeline uses for Italy's zones).
 */
export function series(data: Periods, area: Area, unit: Unit): EnergySeries {
  const codes = area === ALL ? Object.keys(data.countries).sort() : [area];
  const blocks = codes.map((code) => {
    const country = data.countries[code];
    if (!country) throw new DataError(`no energy data for ${code}`);
    const block = unit === "month" ? country.months : country.years;
    checkBlock(block, `${code} ${unit}s`);
    return block;
  });
  const first = blocks[0];
  if (!first) throw new DataError("no countries with energy data");
  const periods = first.periods;
  if (blocks.some((b) => b.periods.join() !== periods.join())) {
    throw new DataError("countries cover different periods");
  }
  const n = periods.length;
  const generation: Partial<Record<Technology, (number | null)[]>> = {};
  const pumping: (number | null)[] = Array<number | null>(n).fill(null);
  const load: (number | null)[] = Array<number | null>(n).fill(null);
  const coverage = Array<number>(n).fill(1);
  const loadCoverage = Array<number>(n).fill(1);
  for (const block of blocks) {
    for (const [raw, values] of Object.entries(block.generation)) {
      const tech: Technology = isOneOf(TECHNOLOGIES, raw) ? raw : "other";
      const target = (generation[tech] ??= Array<number | null>(n).fill(null));
      values.forEach((v, i) => (target[i] = add(target[i], v)));
    }
    (block.consumption.pumped_storage ?? []).forEach((v, i) => (pumping[i] = add(pumping[i], v)));
    block.load.forEach((v, i) => (load[i] = add(load[i], v)));
    block.coverage.generation.forEach((v, i) => (coverage[i] = Math.min(coverage[i] ?? 1, v)));
    block.coverage.load.forEach((v, i) => (loadCoverage[i] = Math.min(loadCoverage[i] ?? 1, v)));
  }
  return { periods, generation, pumping, load, coverage, loadCoverage, countries: codes };
}

/** Technologies present in a series, largest total first. */
export function technologiesOf(data: EnergySeries): Technology[] {
  const total = (values: (number | null)[] | undefined): number =>
    (values ?? []).reduce<number>((sum, v) => sum + (v ?? 0), 0);
  return TECHNOLOGIES.filter((t) => data.generation[t]?.some((v) => v !== null)).sort(
    (a, b) => total(data.generation[b]) - total(data.generation[a]),
  );
}

export interface YearLine {
  year: string;
  /** January … December; null where the month has no data */
  values: (number | null)[];
  coverage: number[];
}

/** The same month across years, for one technology (from a monthly series). */
export function compareYears(monthly: EnergySeries, tech: Technology): YearLine[] {
  const byYear = new Map<string, YearLine>();
  monthly.periods.forEach((period, i) => {
    const [year, month] = period.split("-");
    if (!year || !month) return;
    const line = byYear.get(year) ?? {
      year,
      values: Array<number | null>(12).fill(null),
      coverage: Array<number>(12).fill(0),
    };
    const index = Number(month) - 1;
    line.values[index] = monthly.generation[tech]?.[i] ?? null;
    line.coverage[index] = monthly.coverage[i] ?? 0;
    byYear.set(year, line);
  });
  return [...byYear.values()].filter((line) => line.values.some((v) => v !== null));
}

// ---------------------------------------------------------------- date ranges

export interface RangeTotals {
  days: number;
  coveredDays: number;
  loadCoveredDays: number;
  generation: { tech: Technology; mwh: number }[];
  total: number;
  pumping: number;
  /** null unless the load is known for every day of the range */
  load: number | null;
}

export const MAX_RANGE_DAYS = 3 * 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function rangeDays(from: string, to: string): number | null {
  if (!DATE.test(from) || !DATE.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const days = Math.round((end - start) / 86_400_000) + 1;
  return days > MAX_RANGE_DAYS ? null : days;
}

export function yearsInRange(from: string, to: string): number[] {
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/**
 * Sum daily values between two dates (inclusive). A day counts as covered only if every included country
 * reported something for it; totals include whatever was reported.
 */
export function rangeTotals(
  files: YearFile[],
  area: Area,
  codes: string[],
  from: string,
  to: string,
): RangeTotals {
  const days = rangeDays(from, to);
  if (days === null) throw new DataError(`invalid range ${from} – ${to}`);
  const included = area === ALL ? codes : [area];
  const sums = new Map<Technology, number>();
  let pumping = 0;
  let load = 0;
  let coveredDays = 0;
  let loadCoveredDays = 0;
  for (const file of files) {
    file.days.forEach((day, i) => {
      if (day < from || day > to) return;
      let covered = true;
      let loadCovered = true;
      for (const code of included) {
        const country = file.countries[code];
        if (!country || (country.coverage.generation[i] ?? 0) <= 0) covered = false;
        if (!country || (country.coverage.load[i] ?? 0) <= 0) loadCovered = false;
        if (!country) continue;
        for (const [raw, values] of Object.entries(country.generation)) {
          const tech: Technology = isOneOf(TECHNOLOGIES, raw) ? raw : "other";
          const value = values[i];
          if (value !== null && value !== undefined) sums.set(tech, (sums.get(tech) ?? 0) + value);
        }
        pumping += country.consumption.pumped_storage?.[i] ?? 0;
        load += country.load[i] ?? 0;
      }
      if (covered) coveredDays += 1;
      if (loadCovered) loadCoveredDays += 1;
    });
  }
  const generation = [...sums.entries()].map(([tech, mwh]) => ({ tech, mwh })).sort((a, b) => b.mwh - a.mwh);
  return {
    days,
    coveredDays,
    loadCoveredDays,
    generation,
    total: generation.reduce((sum, row) => sum + row.mwh, 0),
    pumping,
    load: loadCoveredDays === days ? load : null,
  };
}
