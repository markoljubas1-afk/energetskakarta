/**
 * A point of light travelling along a route (Faza 35-3): where it is after a given share of the way, and
 * the trail it has left. Plain geometry on the route's own points; nothing here knows about the map.
 *
 * Distances are measured on a flat map scaled by the cosine of the latitude, as the pipeline measures them
 * (routes.py): over a few hundred kilometres the difference from the sphere is far below a pixel.
 */
export type Position = [number, number];

export interface Measured {
  points: readonly Position[];
  /** distance from the start to each point, in the same (arbitrary) unit; the last one is the length */
  along: readonly number[];
}

function span(a: Position, b: Position): number {
  const shrink = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * shrink, a[1] - b[1]);
}

export function measure(points: readonly Position[]): Measured {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    const here = points[i];
    const before = points[i - 1];
    along.push((along[i - 1] ?? 0) + (here && before ? span(before, here) : 0));
  }
  return { points, along };
}

export interface Traveller {
  /** where the light is */
  head: Position;
  /** the way it has come, from the start up to and including `head` */
  trail: Position[];
}

/** The traveller after `share` of the way: 0 is the start, 1 the end; values outside are clamped. */
export function travellerAt(route: Measured, share: number): Traveller | null {
  const first = route.points[0];
  const last = route.points[route.points.length - 1];
  if (!first || !last) return null;
  const length = route.along[route.along.length - 1] ?? 0;
  const target = Math.min(1, Math.max(0, share)) * length;
  if (target <= 0 || length === 0) return { head: first, trail: [first] };
  if (target >= length) return { head: last, trail: [...route.points] };
  // the first point at or past the target; the route is a few hundred points, so a plain scan is enough
  const next = route.along.findIndex((distance) => distance >= target);
  const a = route.points[next - 1];
  const b = route.points[next];
  const from = route.along[next - 1];
  const to = route.along[next];
  if (!a || !b || from === undefined || to === undefined) return { head: last, trail: [...route.points] };
  const part = to === from ? 0 : (target - from) / (to - from);
  const head: Position = [a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part];
  return { head, trail: [...route.points.slice(0, next), head] };
}

/** How long the light takes for the whole way, whatever the route's length: a story, not a simulation. */
export const TRAVEL_MS = 14_000;

/** Smooth start and stop: the light leaves and arrives gently instead of at full speed. */
export function eased(linear: number): number {
  const t = Math.min(1, Math.max(0, linear));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
