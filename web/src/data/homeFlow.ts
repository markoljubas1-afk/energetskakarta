/**
 * "A house with solar panels" in the solar calculator (Faza 42): where the electricity goes in each hour of
 * an average day of a month. Built from two published shapes (pipeline/src/energymap/solar/home.py):
 *
 * - the sun: PVGIS's long-term average irradiance on a south-facing plane of 35°, hour by hour for an
 *   average day of each month, for the grid point nearest the place. Only its SHAPE is used: the yearly
 *   amount is the calculator's own (the atlas yield times the installed power), so the two cannot disagree;
 * - the household: HEP ODS's standard load curve of the household group (K0), scaled to the yearly
 *   consumption the reader gave. It is the curve of a group, not of one home.
 *
 * What it is and is not: an average day. Real days are cloudier or sunnier than the average, so a real
 * house uses a lower share of its own electricity (an average day matches sun and use better than real days
 * do: min(pv, load) of the averages is at least the average of the mins); every text that shows these figures says
 * "an average day" and calls the shares a calculation. The battery charges only from the surplus of the
 * panels, loses a stated share on charging and has no limit on its power: assumptions, printed with it.
 */
import { z } from "zod";

import { assetUrl, DataError } from "./current";

export const MONTHS = 12;
export const HOURS = 24;
const Day = z.array(z.number().nonnegative()).length(HOURS);
const Year = z.array(Day).length(MONTHS);

export const HomeShapesSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  timezone: z.string(),
  sun: z.object({
    source: z.string(),
    sourceUrl: z.url(),
    license: z.string(),
    attribution: z.string(),
    plane: z.object({ slopeDeg: z.number(), azimuthDeg: z.number() }),
    unit: z.string(),
    grid: z.object({
      west: z.number(),
      south: z.number(),
      step: z.number().positive(),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }),
    /** row by row from the south-west; null where PVGIS has nothing (the sea) */
    points: z.array(Year.nullable()),
  }),
  household: z.object({
    source: z.string(),
    sourceUrl: z.url(),
    license: z.string(),
    year: z.number().int(),
    group: z.string(),
    unit: z.string(),
    /** average watts per 1000 kWh a year, by month and hour */
    months: Year,
  }),
});
export type HomeShapes = z.infer<typeof HomeShapesSchema>;

export const HOME_KEY = "solar/home.json";

/** The published shapes; null when the bucket has none yet (the calculator then has no house). */
export async function loadHomeShapes(base: URL, signal: AbortSignal): Promise<HomeShapes | null> {
  const response = await fetch(assetUrl(base, HOME_KEY), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new DataError(`the home shapes returned HTTP ${String(response.status)}`);
  const doc = HomeShapesSchema.parse(await response.json());
  if (doc.sun.points.length !== doc.sun.grid.cols * doc.sun.grid.rows) {
    throw new DataError("the home shapes: the points do not fill the grid");
  }
  return doc;
}

/** A point farther than this many grid steps from the place does not speak for it. */
export const NEAR_STEPS = 1.5;

/** A point of the grid: its column from the west and its row from the south. */
export interface GridCell {
  col: number;
  row: number;
}

/**
 * The grid point nearest a place that has a shape; null when none is near enough. The roof planes
 * (data/roofPlanes.ts) are read for the same point, so the house and the calculator never use two places.
 */
export function nearestCell(doc: HomeShapes, lng: number, lat: number): GridCell | null {
  const { west, south, step, cols } = doc.sun.grid;
  let best: GridCell | null = null;
  let bestDistance = Infinity;
  doc.sun.points.forEach((shape, index) => {
    if (shape === null) return;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = west + (col + 0.5) * step;
    const y = south + (row + 0.5) * step;
    const distance = Math.hypot((x - lng) * Math.cos((lat * Math.PI) / 180), y - lat);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { col, row };
    }
  });
  return bestDistance <= NEAR_STEPS * step ? best : null;
}

/** The sun's shape at the grid point nearest a place that has one; null when none is near enough. */
export function sunShapeAt(doc: HomeShapes, lng: number, lat: number): number[][] | null {
  const cell = nearestCell(doc, lng, lat);
  return cell ? (doc.sun.points[cell.row * doc.sun.grid.cols + cell.col] ?? null) : null;
}

/** Days of each month of a common year: the weights of the twelve average days. */
export const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const yearSum = (shape: readonly (readonly number[])[]): number =>
  shape.reduce((sum, day, month) => sum + (DAYS[month] ?? 0) * day.reduce((a, b) => a + b, 0), 0);

/**
 * A shape scaled so that its year adds up to `yearlyKwh`: kWh in each hour of the average day of each
 * month. Null when the shape has nothing in it.
 */
export function scaled(shape: readonly (readonly number[])[], yearlyKwh: number): number[][] | null {
  const total = yearSum(shape);
  if (!(total > 0) || !(yearlyKwh >= 0)) return null;
  return shape.map((day) => day.map((value) => (value / total) * yearlyKwh));
}

/** The share of what goes into the battery that is lost on the way (an assumption, printed with it). */
export const BATTERY_CHARGE_LOSS = 0.1;

/** One hour of the house, in kWh (which is also its average power in kW). */
export interface HourFlow {
  pv: number;
  load: number;
  pvToHome: number;
  pvToBattery: number;
  pvToGrid: number;
  batteryToHome: number;
  gridToHome: number;
  /** kWh in the battery at the end of the hour */
  stored: number;
}

/**
 * The 24 hours of a day that repeats: the battery starts each day as the day before left it (three days
 * are run and the last is kept, which is enough for the day to settle). `batteryKwh` 0 means no battery.
 */
export function simulateDay(pv: readonly number[], load: readonly number[], batteryKwh: number): HourFlow[] {
  const capacity = Math.max(0, batteryKwh);
  let stored = 0;
  let day: HourFlow[] = [];
  for (let round = 0; round < 3; round += 1) {
    day = [];
    for (let hour = 0; hour < HOURS; hour += 1) {
      const made = pv[hour] ?? 0;
      const used = load[hour] ?? 0;
      const pvToHome = Math.min(made, used);
      const surplus = made - pvToHome;
      const deficit = used - pvToHome;
      // what the battery takes arrives smaller by the loss; it takes no more than fills it
      const pvToBattery = Math.min(surplus, (capacity - stored) / (1 - BATTERY_CHARGE_LOSS));
      stored += pvToBattery * (1 - BATTERY_CHARGE_LOSS);
      const batteryToHome = Math.min(deficit, stored);
      stored -= batteryToHome;
      day.push({
        pv: made,
        load: used,
        pvToHome,
        pvToBattery,
        pvToGrid: surplus - pvToBattery,
        batteryToHome,
        gridToHome: deficit - batteryToHome,
        stored,
      });
    }
  }
  return day;
}

export interface Totals {
  pv: number;
  load: number;
  pvToGrid: number;
  gridToHome: number;
  /** the share of what the panels made that stayed in the house (used at once or stored); null without sun */
  selfConsumption: number | null;
  /** the share of what the house used that did not come from the grid; null without consumption */
  selfSufficiency: number | null;
}

function totals(pv: number, load: number, pvToGrid: number, gridToHome: number): Totals {
  return {
    pv,
    load,
    pvToGrid,
    gridToHome,
    selfConsumption: pv > 0 ? (pv - pvToGrid) / pv : null,
    selfSufficiency: load > 0 ? (load - gridToHome) / load : null,
  };
}

const sum = (day: readonly HourFlow[], pick: (hour: HourFlow) => number): number =>
  day.reduce((total, hour) => total + pick(hour), 0);

export const dayTotals = (day: readonly HourFlow[]): Totals =>
  totals(
    sum(day, (h) => h.pv),
    sum(day, (h) => h.load),
    sum(day, (h) => h.pvToGrid),
    sum(day, (h) => h.gridToHome),
  );

export interface HomeYear {
  /** the average day of each month, hour by hour */
  months: HourFlow[][];
  year: Totals;
}

/**
 * The house through the year: twelve average days, each weighted by the days of its month. Null when a
 * shape is empty or an input is not a positive number.
 */
export function homeYear(
  sun: readonly (readonly number[])[],
  household: readonly (readonly number[])[],
  inputs: { yearlyKwh: number; yieldKwhPerKwp: number; kwp: number; batteryKwh: number },
): HomeYear | null {
  const { yearlyKwh, yieldKwhPerKwp, kwp, batteryKwh } = inputs;
  if (!(yearlyKwh > 0) || !(yieldKwhPerKwp > 0) || !(kwp > 0)) return null;
  const pv = scaled(sun, kwp * yieldKwhPerKwp);
  const load = scaled(household, yearlyKwh);
  if (!pv || !load) return null;
  const months = pv.map((day, month) => simulateDay(day, load[month] ?? [], batteryKwh));
  const weighted = (pick: (hour: HourFlow) => number): number =>
    months.reduce((total, day, month) => total + (DAYS[month] ?? 0) * sum(day, pick), 0);
  return {
    months,
    year: totals(
      weighted((h) => h.pv),
      weighted((h) => h.load),
      weighted((h) => h.pvToGrid),
      weighted((h) => h.gridToHome),
    ),
  };
}
