/**
 * Plants added up by cell (pipeline products.plant_grid), so the overview can say what is in the part of the
 * map on screen. Tiles cannot answer that (small plants are not in them at a low zoom) and the search index
 * cannot either (named plants only, no status).
 *
 * The answer is exact to the size of a cell: a cell that the view touches counts whole. The panel says so.
 */
import { z } from "zod";

import { isOneOf, STATUSES, TECHNOLOGIES, type Technology } from "../domain";
import type { TechnologyTotal } from "./stats";

export const PlantGridSchema = z.object({
  version: z.literal(1),
  cellDeg: z.number().positive(),
  fields: z.tuple([
    z.literal("lon"),
    z.literal("lat"),
    z.literal("technology"),
    z.literal("status"),
    z.literal("count"),
    z.literal("withCapacity"),
    z.literal("capacityMw"),
  ]),
  rows: z.array(
    z.tuple([
      z.number(),
      z.number(),
      z.string(),
      z.string(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().nonnegative(),
    ]),
  ),
});
export type PlantGrid = z.infer<typeof PlantGridSchema>;

export type Bounds = [west: number, south: number, east: number, north: number];

export interface ViewSummary {
  technologies: TechnologyTotal[];
  operatingMw: number;
  pipelineMw: number;
}

/** Totals of the cells that the view touches, in the shape the overview draws for a country. */
export function summarizeView(grid: PlantGrid, [west, south, east, north]: Bounds): ViewSummary {
  const totals = new Map<Technology, TechnologyTotal>();
  for (const [lon, lat, technology, status, count, withCapacity, capacityMw] of grid.rows) {
    if (lon >= east || lon + grid.cellDeg <= west || lat >= north || lat + grid.cellDeg <= south) continue;
    if (!isOneOf(TECHNOLOGIES, technology) || !isOneOf(STATUSES, status)) continue;
    const total = totals.get(technology) ?? {
      technology,
      operatingMw: 0,
      pipelineMw: 0,
      plants: 0,
      operatingPlants: 0,
      plantsWithoutCapacity: 0,
    };
    if (status === "operating") {
      total.operatingMw += capacityMw;
      total.operatingPlants += count;
    } else total.pipelineMw += capacityMw;
    total.plants += count;
    total.plantsWithoutCapacity += count - withCapacity;
    totals.set(technology, total);
  }
  const technologies = [...totals.values()].sort(
    (a, b) => b.operatingMw - a.operatingMw || b.pipelineMw - a.pipelineMw || b.plants - a.plants,
  );
  return {
    technologies,
    operatingMw: technologies.reduce((sum, row) => sum + row.operatingMw, 0),
    pipelineMw: technologies.reduce((sum, row) => sum + row.pipelineMw, 0),
  };
}
