/**
 * Routes along real transmission lines (pipeline routes.py), for the guided stories: the path a point of
 * light follows from a plant towards a city. Made by our own build from its own lines; a build whose lines
 * no longer connect a route's ends has no such route, and the story that needs it is not offered.
 */
import { z } from "zod";

import { DataError } from "./current";

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const RouteSchema = z.object({
  from: z.string(),
  to: z.string(),
  minKv: z.number(),
  km: z.number().positive(),
  lines: z.number().int().positive(),
  stops: z.array(Position).min(2),
  coordinates: z.array(Position).min(2),
});
export type Route = z.infer<typeof RouteSchema>;

export const RoutesSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  license: z.string(),
  routes: z.record(z.string(), RouteSchema),
});
export type Routes = z.infer<typeof RoutesSchema>;

export async function loadRoutes(url: string, signal: AbortSignal): Promise<Routes> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new DataError(`routes returned HTTP ${response.status}`);
  return RoutesSchema.parse(await response.json());
}
