/**
 * The rows behind the map's bars (Faza 27), exactly as each bar shows them: the hour's electricity mix, the
 * time machine's capacity by year, and the geothermal sites. Numbers stay as the data has them.
 */
import type { Geothermal } from "../data/geothermal";
import type { Mix } from "../data/mix";
import type { CountryCode, Technology } from "../domain";
import type { Table } from "./csv";

const percent = (share: number): number => Math.round(share * 10_000) / 100;

export interface MixLabels {
  source: string;
  share: string;
  total: string;
  /** "Uvoz: Slovenija" */
  importFrom: (country: string) => string;
  unknown: string;
  technology: (tech: Technology) => string;
  country: (code: CountryCode) => string;
}

/** The hour's mix: every source with MW and share, then each import, the unexplained imports and the total. */
export function mixTable(mix: Mix, labels: MixLabels): Table {
  const unknownShare = mix.totalMw > 0 ? mix.unknownImportMw / mix.totalMw : 0;
  return {
    header: [labels.source, "MW", `${labels.share} (%)`],
    rows: [
      ...mix.technologies.map((part) => [labels.technology(part.technology), part.mw, percent(part.share)]),
      ...mix.imports.map((item) => [
        labels.importFrom(labels.country(item.country)),
        item.mw,
        percent(item.share),
      ]),
      ...(mix.unknownImportMw > 0 ? [[labels.unknown, mix.unknownImportMw, percent(unknownShare)]] : []),
      [labels.total, mix.totalMw, 100],
    ],
  };
}

/** The time machine's chart: MW in operation per source for every year. */
export function timelineTable(
  rows: readonly { technology: Technology; mw: readonly number[] }[],
  firstYear: number,
  labels: { year: string; technology: (tech: Technology) => string },
): Table {
  const years = rows[0]?.mw.length ?? 0;
  return {
    header: [labels.year, ...rows.map((row) => `${labels.technology(row.technology)} (MW)`)],
    rows: Array.from({ length: years }, (_, i) => [firstYear + i, ...rows.map((row) => row.mw[i] ?? 0)]),
  };
}

export interface GeothermalLabels {
  site: string;
  place: string;
  phase: string;
  electric: string;
  thermal: string;
  temperature: string;
  uses: string;
  sources: string;
  phaseName: (phase: Geothermal["sites"][number]["status"]) => string;
}

/** Every geothermal site with its figures and its sources. */
export function geothermalTable(doc: Geothermal, labels: GeothermalLabels): Table {
  return {
    header: [
      labels.site,
      labels.place,
      labels.phase,
      `${labels.electric} (MW)`,
      `${labels.thermal} (MW)`,
      `${labels.temperature} (°C)`,
      labels.uses,
      labels.sources,
    ],
    rows: doc.sites.map((site) => [
      site.name,
      site.place,
      labels.phaseName(site.status),
      site.electricMw ?? null,
      site.thermalMw ?? null,
      site.temperatureC ?? null,
      site.uses.join(" "),
      site.sources.join(" "),
    ]),
  };
}
