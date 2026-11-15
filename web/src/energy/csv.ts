/**
 * The rows behind each card of the energy page, exactly as the chart or table shows them (Faza 23-4).
 * Values stay as published (MWh, unrounded); periods stay machine-readable ("2026-03", "2026").
 */
import type { EnergySeries, RangeTotals, YearLine } from "../data/energy";
import type { Technology } from "../domain";
import type { Table } from "../share/csv";

export interface CsvLabels {
  period: string;
  load: string;
  complete: string;
  year: string;
  source: string;
  shareOfGeneration: string;
  shareOfLoad: string;
  total: string;
  pumping: string;
  months: readonly string[];
  technology: (tech: Technology) => string;
}

const percent = (share: number): number => Math.round(share * 10_000) / 100;

/** Generation by source and load, one row per month or year. */
export function mixTable(data: EnergySeries, techs: readonly Technology[], labels: CsvLabels): Table {
  return {
    header: [
      labels.period,
      ...techs.map((tech) => `${labels.technology(tech)} (MWh)`),
      `${labels.load} (MWh)`,
      `${labels.complete} (%)`,
    ],
    rows: data.periods.map((period, i) => [
      period,
      ...techs.map((tech) => data.generation[tech]?.[i] ?? null),
      data.load[i] ?? null,
      percent(data.coverage[i] ?? 0),
    ]),
  };
}

/** The same month across years for one source, one row per year. */
export function compareTable(lines: readonly YearLine[], labels: CsvLabels): Table {
  return {
    header: [labels.year, ...labels.months.map((month) => `${month} (MWh)`)],
    rows: lines.map((line) => [line.year, ...line.values]),
  };
}

/** Totals for a chosen period: each source, then the total, the load and pumping. */
export function rangeTable(totals: RangeTotals, labels: CsvLabels): Table {
  const share = (mwh: number, of: number | null): number | null => (of ? percent(mwh / of) : null);
  return {
    header: [labels.source, "MWh", `${labels.shareOfGeneration} (%)`, `${labels.shareOfLoad} (%)`],
    rows: [
      ...totals.generation.map((row) => [
        labels.technology(row.tech),
        row.mwh,
        share(row.mwh, totals.total),
        share(row.mwh, totals.load),
      ]),
      [labels.total, totals.total, totals.total > 0 ? 100 : null, share(totals.total, totals.load)],
      [labels.load, totals.load, null, null],
      ...(totals.pumping > 0 ? [[labels.pumping, totals.pumping, null, null]] : []),
    ],
  };
}
