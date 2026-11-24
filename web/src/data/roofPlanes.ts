/**
 * The way a roof faces (Faza 52, pipeline/src/energymap/solar/planes.py): for each point of the grid of the
 * home shapes, PVGIS 5.3's yearly output of 1 kWp on every roof plane the calculator offers, the best plane
 * of the place, and each plane's average day of each month.
 *
 * The calculator's amount stays the Global Solar Atlas's (which counts the best plane, facing south); from
 * PVGIS it takes only how much a plane gives of what the best plane gives at the same point. One small file
 * a point, read when someone clicks near it.
 */
import { z } from "zod";

import { assetUrl, DataError } from "./current";
import type { GridCell } from "./homeFlow";

const Day = z.array(z.number().nonnegative()).length(24);

/** The directions on offer, as the pipeline names them, and a flat roof (racks of 10° towards the south). */
export const FACINGS = ["S", "SE", "SW", "E", "W", "flat"] as const;
export type Facing = (typeof FACINGS)[number];
export const SLOPES = [15, 30, 45] as const;
export type Slope = (typeof SLOPES)[number];

const PlaneSchema = z.object({
  id: z.string(),
  facing: z.enum(FACINGS),
  slopeDeg: z.number(),
  azimuthDeg: z.number(),
  yearlyKwh: z.number().positive(),
  /** W/m² on the plane, hour by local hour, of the average day of each month */
  shape: z.array(Day).length(12),
});

export const RoofPlanesSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  sourceUrl: z.url(),
  license: z.string(),
  attribution: z.string(),
  systemLossPercent: z.number(),
  cell: z.object({ col: z.number().int(), row: z.number().int(), lon: z.number(), lat: z.number() }),
  best: z.object({ slopeDeg: z.number(), azimuthDeg: z.number(), yearlyKwh: z.number().positive() }),
  planes: z.array(PlaneSchema).min(1),
});
export type RoofPlanes = z.infer<typeof RoofPlanesSchema>;
export type RoofPlane = RoofPlanes["planes"][number];

export const planesKey = (cell: GridCell): string =>
  `solar/planes/${String(cell.col)}-${String(cell.row)}.json`;

/** The planes of one grid point; null when the bucket has none for it (the calculator then counts the best roof). */
export async function loadRoofPlanes(
  base: URL,
  key: string,
  signal: AbortSignal,
): Promise<RoofPlanes | null> {
  const response = await fetch(assetUrl(base, key), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new DataError(`the roof planes returned HTTP ${String(response.status)}`);
  return RoofPlanesSchema.parse(await response.json());
}

/** The plane of a direction and a tilt; a flat roof has its one plane whatever the tilt. */
export function planeOf(doc: RoofPlanes, facing: Facing, slope: Slope): RoofPlane | null {
  return (
    doc.planes.find((plane) => plane.facing === facing && (facing === "flat" || plane.slopeDeg === slope)) ??
    null
  );
}

/**
 * How much of the best plane's output a plane gives at this point, at most all of it: PVGIS rounds the best
 * angles to whole degrees, so a neighbouring plane can come out a hair above "the best".
 */
export function planeShare(doc: RoofPlanes, plane: RoofPlane): number {
  return Math.min(1, plane.yearlyKwh / doc.best.yearlyKwh);
}
