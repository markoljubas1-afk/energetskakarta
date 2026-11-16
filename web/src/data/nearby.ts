/**
 * The grid next to a plant (pipeline nearby.py): its nearest substation, how far it is, and the lines that
 * end there. Geometry, not a statement about connections: no open source records which plant feeds which
 * substation. Only plants with a plain answer have an entry.
 */
import { z } from "zod";

import { DataError } from "./current";

export const NearbySchema = z.object({
  version: z.literal(1),
  plantReachKm: z.number(),
  lineReachKm: z.number(),
  fields: z.tuple([z.literal("substation"), z.literal("metres"), z.literal("lines")]),
  plants: z.record(z.string(), z.tuple([z.string(), z.number().nonnegative(), z.array(z.string()).min(1)])),
});
export type Nearby = z.infer<typeof NearbySchema>;

/** What is lit on the map and said in the details of a selected plant. */
export interface Around {
  /** the nearest substation's id */
  substation: string;
  /** how far it is from the plant */
  metres: number;
  /** ids of the lines that end at that substation */
  lines: string[];
}

export async function loadNearby(url: string, signal: AbortSignal): Promise<Nearby> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new DataError(`nearby grid returned HTTP ${response.status}`);
  return NearbySchema.parse(await response.json());
}

export function aroundOf(nearby: Nearby, plantId: string): Around | null {
  const entry = nearby.plants[plantId];
  if (!entry) return null;
  const [substation, metres, lines] = entry;
  return { substation, metres, lines };
}
