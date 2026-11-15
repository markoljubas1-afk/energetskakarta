/** The change report a build publishes against the previous one (pipeline/src/energymap/diff.py). */
import { z } from "zod";

import { isOneOf, SCOPE_COUNTRIES, type CountryCode, type LayerKey } from "../domain";

const Example = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  /** absent for a feature whose geometry the pipeline could not read */
  lon: z.number().optional(),
  lat: z.number().optional(),
});
export type DiffExample = z.infer<typeof Example>;

export const CHANGE_KINDS = ["added", "changed", "removed"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

const Counts = z.object({ added: z.number().int(), changed: z.number().int(), removed: z.number().int() });

const LayerReport = Counts.extend({
  unchanged: z.number().int(),
  byCountry: z.record(z.string(), Counts.partial()),
  examples: z.object({ added: z.array(Example), changed: z.array(Example), removed: z.array(Example) }),
});

export const DiffSchema = z.object({
  version: z.literal(1),
  buildId: z.string(),
  /** null on the first publication: everything counts as new */
  baselineBuildId: z.string().nullable(),
  layers: z.record(z.string(), LayerReport),
});
export type Diff = z.infer<typeof DiffSchema>;

/** Data layers in the report, in the order the site presents them, and the switch that shows each. */
export const DIFF_LAYERS = [
  "plants",
  "lines",
  "substations",
  "pipelines",
  "datacenters",
  "chargers",
  "extraction",
  "distribution_lines",
  "distribution_substations",
] as const;
export type DiffLayer = (typeof DIFF_LAYERS)[number];

export const LAYER_SWITCH: Record<DiffLayer, LayerKey> = {
  plants: "plants",
  lines: "lines",
  substations: "substations",
  pipelines: "pipelines",
  datacenters: "datacenters",
  chargers: "chargers",
  extraction: "extraction",
  distribution_lines: "distribution",
  distribution_substations: "distribution",
};

export interface LayerChanges {
  layer: DiffLayer;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  examples: { kind: ChangeKind; example: DiffExample }[];
}

export interface ChangeSummary {
  /** "20260901T000000Z" as an ISO instant, or null on the first publication */
  since: string | null;
  totals: { added: number; changed: number; removed: number };
  /** layers with at least one change, busiest first */
  layers: LayerChanges[];
  /** scope countries with at least one change, busiest first */
  countries: { country: CountryCode; added: number; changed: number; removed: number }[];
}

/** "20260901T123000Z" → "2026-09-01T12:30:00Z"; anything else stays as it is. */
export function buildInstant(buildId: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(buildId);
  if (!match) return buildId;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

const activity = (c: { added: number; changed: number; removed: number }): number =>
  c.added + c.changed + c.removed;

export function summarizeDiff(diff: Diff, exampleLimit = 5): ChangeSummary {
  const totals = { added: 0, changed: 0, removed: 0 };
  const byCountry = new Map<CountryCode, { added: number; changed: number; removed: number }>();
  const layers: LayerChanges[] = [];

  for (const layer of DIFF_LAYERS) {
    const report = diff.layers[layer];
    if (!report) continue;
    totals.added += report.added;
    totals.changed += report.changed;
    totals.removed += report.removed;
    for (const [code, counts] of Object.entries(report.byCountry)) {
      if (!isOneOf(SCOPE_COUNTRIES, code)) continue;
      const row = byCountry.get(code) ?? { added: 0, changed: 0, removed: 0 };
      row.added += counts.added ?? 0;
      row.changed += counts.changed ?? 0;
      row.removed += counts.removed ?? 0;
      byCountry.set(code, row);
    }
    if (activity(report) === 0) continue;
    // a few of each kind, new ones first: what a reader most wants to look at
    const examples = CHANGE_KINDS.flatMap((kind) =>
      report.examples[kind].slice(0, exampleLimit).map((example) => ({ kind, example })),
    );
    layers.push({
      layer,
      added: report.added,
      changed: report.changed,
      removed: report.removed,
      unchanged: report.unchanged,
      examples,
    });
  }
  layers.sort((a, b) => activity(b) - activity(a));

  const countries = [...byCountry.entries()]
    .map(([country, counts]) => ({ country, ...counts }))
    .filter((row) => activity(row) > 0)
    .sort((a, b) => activity(b) - activity(a));

  return {
    since: diff.baselineBuildId === null ? null : buildInstant(diff.baselineBuildId),
    totals,
    layers,
    countries,
  };
}
