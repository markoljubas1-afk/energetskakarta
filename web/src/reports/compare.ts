/**
 * The comparisons of the "Usporedbe" page (Faza 49): one month across the years, one year against another,
 * and the countries side by side. Pure functions over the monthly and yearly totals the energy page already
 * loads (`energy/periods.json`), counted exactly as the monthly reports count them (`seriesRows`,
 * `rowIntensity`), so a figure here is the figure in the report.
 *
 * Nothing is estimated: a period reported in part is either left out or marked as such by its row, a country
 * without figures for a period is left out (never shown as zero), and a year still under way is compared
 * with the same months of the other year only.
 */
import { ALL, series, type Area, type Periods } from "../data/energy";
import { priceMonth, type PriceMonths } from "../data/priceMonths";
import { SCOPE_COUNTRIES, TECHNOLOGIES, type CountryCode, type Technology } from "../domain";
import { RENEWABLE, seriesRows, type PeriodRow } from "../seo/energyPages";
import { rowIntensity } from "../seo/report";

export type { PeriodRow };
export { rowIntensity };

/** A period worth comparing: reported in full (the reports' rule), and something was generated. */
export const usable = (row: PeriodRow | undefined): row is PeriodRow =>
  row !== undefined && row.complete && row.total !== null && row.total > 0;

/** The months or years of a country or of the region, oldest first; null when there is nothing for it. */
export function areaRows(periods: Periods, area: Area, unit: "month" | "year"): PeriodRow[] | null {
  if (Object.keys(periods.countries).length === 0) return null;
  if (area !== ALL && !periods.countries[area]) return null;
  return seriesRows(series(periods, area, unit));
}

/** The latest period reported in full, or null. */
export const latestUsable = (rows: readonly PeriodRow[]): string | null =>
  [...rows].reverse().find(usable)?.period ?? null;

const monthKey = (year: string, month: number): string => `${year}-${String(month).padStart(2, "0")}`;

// ---------------------------------------------------------------- what is shown

export interface Choice {
  month: number | null;
  years: readonly [string, string] | null;
  period: string | null;
}

/**
 * What the page shows for the visitor's choices: each one kept when the data has it, otherwise the latest
 * (the latest complete month's month, the two latest years, the latest period two countries reported in
 * full). The page writes the result into its address at once, so a link shared or cited without touching
 * anything still opens these figures next month, not the next month's.
 */
export function resolveChoice(
  choice: Choice,
  monthRows: readonly PeriodRow[],
  periodOptions: readonly string[],
): Choice {
  const latest = latestUsable(monthRows);
  const years = yearsOf(monthRows);
  const [newest, before] = years;
  return {
    month: choice.month ?? (latest ? Number(latest.slice(5, 7)) : null),
    years:
      choice.years && years.includes(choice.years[0]) && years.includes(choice.years[1])
        ? choice.years
        : newest && before
          ? [before, newest]
          : null,
    period:
      choice.period !== null && periodOptions.includes(choice.period)
        ? choice.period
        : (periodOptions[0] ?? null),
  };
}

export const sameChoice = (a: Choice, b: Choice): boolean =>
  a.month === b.month && a.period === b.period && (a.years?.join() ?? "") === (b.years?.join() ?? "");

// ---------------------------------------------------------------- one month across the years

/**
 * The month (1–12) of every year that has figures for it, oldest first. A month reported only in part stays
 * in, and its row says so (`complete`), so the chart draws it pale and the table marks it.
 */
export function monthAcrossYears(monthRows: readonly PeriodRow[], month: number): PeriodRow[] {
  const suffix = `-${String(month).padStart(2, "0")}`;
  return monthRows.filter((row) => row.period.endsWith(suffix) && row.total !== null && row.total > 0);
}

// ---------------------------------------------------------------- one year against another

export interface YearPair {
  a: string;
  b: string;
  /** the months (1–12) reported in full in both years: the only ones compared */
  months: number[];
  /** by source, the larger first; a source neither year had is left out */
  rows: { tech: Technology; a: number; b: number }[];
  total: { a: number; b: number };
  renewable: { a: number; b: number };
}

/** The years with at least one month reported in full, newest first. */
export function yearsOf(monthRows: readonly PeriodRow[]): string[] {
  const years = new Set(monthRows.filter(usable).map((row) => row.period.slice(0, 4)));
  return [...years].sort().reverse();
}

/**
 * Year `a` against year `b`, by source, over the months both reported in full: a year under way is compared
 * with the same months of the other one (January to October against January to October), never with all
 * of it. Null when the two years share no complete month.
 */
export function yearAgainstYear(monthRows: readonly PeriodRow[], a: string, b: string): YearPair | null {
  const byPeriod = new Map(monthRows.map((row) => [row.period, row]));
  const months: number[] = [];
  const sums = { a: new Map<Technology, number>(), b: new Map<Technology, number>() };
  for (let month = 1; month <= 12; month += 1) {
    const first = byPeriod.get(monthKey(a, month));
    const second = byPeriod.get(monthKey(b, month));
    if (!usable(first) || !usable(second)) continue;
    months.push(month);
    for (const [side, row] of [
      ["a", first],
      ["b", second],
    ] as const) {
      for (const tech of TECHNOLOGIES) {
        const value = row.byTech[tech];
        if (value !== undefined) sums[side].set(tech, (sums[side].get(tech) ?? 0) + value);
      }
    }
  }
  if (months.length === 0) return null;
  const rows = TECHNOLOGIES.filter((tech) => sums.a.has(tech) || sums.b.has(tech))
    .map((tech) => ({ tech, a: sums.a.get(tech) ?? 0, b: sums.b.get(tech) ?? 0 }))
    .filter((row) => row.a !== 0 || row.b !== 0)
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
  const add = (side: "a" | "b", only?: readonly Technology[]): number =>
    rows.reduce((sum, row) => sum + (only === undefined || only.includes(row.tech) ? row[side] : 0), 0);
  return {
    a,
    b,
    months,
    rows,
    total: { a: add("a"), b: add("b") },
    renewable: { a: add("a", RENEWABLE), b: add("b", RENEWABLE) },
  };
}

/** The change from `a` to `b` as a share of `a` (0.12 for +12 %); null when `a` is zero. */
export const change = (a: number, b: number): number | null => (a > 0 ? (b - a) / a : null);

// ---------------------------------------------------------------- the countries side by side

export interface CountryRow {
  code: CountryCode;
  row: PeriodRow;
  /** g CO₂-eq/kWh, a calculation from the mix (data/co2.ts) */
  intensity: number | null;
  /** the month's average day-ahead price in €/MWh, when every hour of it has one; never for a year */
  price: number | null;
}

/**
 * Every country reported in full for the period, the highest renewable share first. A country without
 * complete figures for it is left out.
 */
export function countriesSide(
  periods: Periods,
  unit: "month" | "year",
  period: string,
  prices: PriceMonths | null,
): CountryRow[] {
  const found: CountryRow[] = [];
  for (const code of SCOPE_COUNTRIES) {
    if (!periods.countries[code]) continue;
    const row = seriesRows(series(periods, code, unit)).find((each) => each.period === period);
    if (!usable(row)) continue;
    found.push({
      code,
      row,
      intensity: rowIntensity(row),
      price: unit === "month" ? (priceMonth(prices, code, period)?.average ?? null) : null,
    });
  }
  return found.sort((x, y) => (y.row.share ?? 0) - (x.row.share ?? 0));
}

/** The periods at least two countries reported in full (worth putting side by side), newest first. */
export function countryPeriods(periods: Periods, unit: "month" | "year"): string[] {
  const counts = new Map<string, number>();
  for (const code of SCOPE_COUNTRIES) {
    if (!periods.countries[code]) continue;
    for (const row of seriesRows(series(periods, code, unit))) {
      if (usable(row)) counts.set(row.period, (counts.get(row.period) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([period]) => period)
    .sort()
    .reverse();
}
