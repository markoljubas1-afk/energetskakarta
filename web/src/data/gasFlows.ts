/**
 * What entered a country's gas transmission system on a gas day and where it went
 * (pipeline/src/energymap/gas/flows.py), from the ENTSOG Transparency Platform.
 *
 * What the figures are: the transmission operator's own report of the physical flow at each of its points
 * (the LNG terminal, production, storage, each border point in both directions, and the exit to consumers
 * and distribution), usually still marked provisional. What they are not: a statement of who "covered"
 * the country's needs. Gas that enters also leaves across the border and into storage, and the difference
 * between what entered and what left stays in the pipes.
 */
import { z } from "zod";

import { assetUrl, DataError } from "./current";

const POINT_KINDS = ["LNG", "PRD", "UGS", "ITP", "VIP", "FNC", "DIS", "OTHER"] as const;
export type PointKind = (typeof POINT_KINDS)[number];

export const GasFlowsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string().min(1),
  sourceUrl: z.url(),
  unit: z.literal("kWh/d"),
  /** gas days, ascending */
  days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  countries: z.record(
    z.string(),
    z.object({
      operatorKey: z.string(),
      operator: z.string(),
      points: z.array(
        z.object({
          key: z.string().min(1),
          label: z.string(),
          kind: z.enum(POINT_KINDS),
          direction: z.enum(["entry", "exit"]),
          /** the country across the border, for an interconnection */
          neighbour: z.string().nullable(),
          kwhPerDay: z.array(z.number().nonnegative().nullable()),
          /** P provisional, C confirmed; null: the platform gave neither, or no figure */
          status: z.array(z.enum(["P", "C"]).nullable()),
        }),
      ),
    }),
  ),
  missing: z.array(z.string()),
});
export type GasFlows = z.infer<typeof GasFlowsSchema>;
type Point = GasFlows["countries"][string]["points"][number];

export type GasFlowsLoad = { kind: "none" } | { kind: "ready"; flows: GasFlows };

export const GAS_FLOWS_KEY = "live/gasflows.json";

export async function loadGasFlows(base: URL, signal: AbortSignal): Promise<GasFlowsLoad> {
  const url = `${assetUrl(base, GAS_FLOWS_KEY)}?t=${Math.floor(Date.now() / 3_600_000)}`;
  const response = await fetch(url, { signal });
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) throw new DataError(`gas flows returned HTTP ${response.status}`);
  const flows = GasFlowsSchema.parse(await response.json());
  for (const [country, system] of Object.entries(flows.countries)) {
    for (const point of system.points) {
      if (point.kwhPerDay.length !== flows.days.length || point.status.length !== flows.days.length) {
        throw new DataError(`gas flows: ${country} ${point.key} does not have one value per day`);
      }
    }
  }
  return { kind: "ready", flows };
}

export interface FlowRow {
  key: string;
  /** the platform's own name of the point */
  label: string;
  kind: PointKind;
  direction: "entry" | "exit";
  neighbour: string | null;
  kwh: number;
  /** its part of everything that entered (or left), 0 to 1; 0 when nothing did */
  share: number;
}

export interface Balance {
  country: string;
  operator: string;
  /** the gas day the figures are of */
  day: string;
  /** largest first; a point through which nothing flowed is kept, with a zero */
  entries: FlowRow[];
  exits: FlowRow[];
  enteredKwh: number;
  leftKwh: number;
  /** what left to final consumers and distribution inside the country; null when no such point reports */
  consumersKwh: number | null;
  /** at least one figure of the day is still provisional */
  provisional: boolean;
  /**
   * What went to consumers on average over the seven gas days before this one; null unless every one of
   * those seven days is in the data with a figure (an average of the days that happen to be there misleads).
   */
  usualConsumersKwh: number | null;
}

/** The days the day's deliveries are compared with. */
export const USUAL_DAYS = 7;

/** What left to consumers and distribution on the day at `index`; null when a point has no figure. */
function consumersOn(points: readonly Point[], index: number): number | null {
  const exits = points.filter(
    (point) => point.direction === "exit" && (point.kind === "FNC" || point.kind === "DIS"),
  );
  if (exits.length === 0 || index < 0) return null;
  let total = 0;
  for (const point of exits) {
    const kwh = point.kwhPerDay[index];
    if (kwh == null) return null;
    total += kwh;
  }
  return total;
}

function usualBefore(points: readonly Point[], index: number): number | null {
  let total = 0;
  for (let back = 1; back <= USUAL_DAYS; back += 1) {
    const kwh = consumersOn(points, index - back);
    if (kwh === null) return null;
    total += kwh;
  }
  return total / USUAL_DAYS;
}

function side(points: readonly Point[], direction: "entry" | "exit", index: number): [FlowRow[], number] {
  const rows = points
    .filter((point) => point.direction === direction)
    .map((point) => ({ point, kwh: point.kwhPerDay[index] ?? 0 }));
  const total = rows.reduce((sum, row) => sum + row.kwh, 0);
  return [
    rows
      .map(({ point, kwh }) => ({
        key: point.key,
        label: point.label,
        kind: point.kind,
        direction,
        neighbour: point.neighbour,
        kwh,
        share: total > 0 ? kwh / total : 0,
      }))
      .sort((a, b) => b.kwh - a.kwh || a.label.localeCompare(b.label)),
    total,
  ];
}

/**
 * A country's balance on the last gas day that every one of its points reported: a day with a point
 * missing would show a system that does not add up. Null when the country is not in the data, or no day is
 * complete, or nothing entered on it.
 */
export function balance(flows: GasFlows, country: string): Balance | null {
  const system = flows.countries[country];
  if (!system || system.points.length === 0) return null;
  for (let index = flows.days.length - 1; index >= 0; index -= 1) {
    if (system.points.some((point) => point.kwhPerDay[index] == null)) continue;
    return balanceOn(flows, country, index);
  }
  return null;
}

/**
 * A country's balance on the gas day at `index`; null when a point did not report that day, or nothing
 * entered on it.
 */
function balanceOn(flows: GasFlows, country: string, index: number): Balance | null {
  const system = flows.countries[country];
  const day = flows.days[index];
  if (!system || system.points.length === 0 || day === undefined) return null;
  if (system.points.some((point) => point.kwhPerDay[index] == null)) return null;
  const [entries, enteredKwh] = side(system.points, "entry", index);
  const [exits, leftKwh] = side(system.points, "exit", index);
  if (!(enteredKwh > 0)) return null;
  return {
    country,
    operator: system.operator,
    day,
    entries,
    exits,
    enteredKwh,
    leftKwh,
    consumersKwh: consumersOn(system.points, index),
    provisional: system.points.some((point) => point.status[index] === "P"),
    usualConsumersKwh: usualBefore(system.points, index),
  };
}

/**
 * The balances of every gas day in the data that has one, oldest first, up to the day `balance` gives:
 * the days the bar lets the reader go back through. Empty when `balance` is null.
 */
export function balances(flows: GasFlows, country: string): Balance[] {
  const latest = balance(flows, country);
  if (!latest) return [];
  const days: Balance[] = [];
  for (let index = 0; index < flows.days.length; index += 1) {
    const day = balanceOn(flows, country, index);
    if (day) days.push(day);
    if (flows.days[index] === latest.day) break;
  }
  return days;
}

/** The countries that have a balance, in the order given. */
export function flowCountries(flows: GasFlows, order: readonly string[]): string[] {
  return order.filter((code) => balance(flows, code) !== null);
}
