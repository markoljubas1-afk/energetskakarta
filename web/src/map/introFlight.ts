/**
 * The camera's path during the first-visit intro (Faza 22), and when each stage of the grid lighting up
 * begins (introStyle.ts says what each stage shows). Pure functions; MapView flies the plan.
 */

/** A MapLibre camera, in plain numbers. */
export interface Camera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface Flight {
  start: Camera;
  /** flown one after another; the last one ends exactly on the map's usual first view */
  legs: readonly { to: Camera; durationMs: number }[];
  /** zooms between which the globe becomes the flat map, or null for a flat flight */
  globe: { from: number; to: number } | null;
  totalMs: number;
}

/**
 * The globe needs a wide screen, and a first view close enough that the globe has room to turn flat after
 * the start (1.9): the region-wide first view is around zoom 4.5 on a laptop.
 */
const GLOBE_MIN_ZOOM = 3.8;
const GLOBE_MIN_WIDTH_PX = 900;

/**
 * From the globe over the Mediterranean, tilted over the Adriatic like the view from a plane, down onto the
 * region; on a phone, a shorter tilted descent. `final` is the view the map shows without the intro.
 */
export function flightPlan(final: { center: [number, number]; zoom: number }, widthPx: number): Flight {
  const [lng, lat] = final.center;
  const end: Camera = { center: [lng, lat], zoom: final.zoom, pitch: 0, bearing: 0 };
  const overAdriatic: Camera = {
    center: [lng - 1.2, lat - 2.4],
    zoom: final.zoom - 0.7,
    pitch: 52,
    bearing: -16,
  };
  if (final.zoom >= GLOBE_MIN_ZOOM && widthPx >= GLOBE_MIN_WIDTH_PX) {
    return {
      start: { center: [lng - 6, lat - 10], zoom: 1.9, pitch: 0, bearing: 0 },
      legs: [
        { to: overAdriatic, durationMs: 650 },
        { to: end, durationMs: 550 },
      ],
      globe: { from: final.zoom - 1.6, to: final.zoom - 0.9 },
      totalMs: 1200,
    };
  }
  return {
    start: { ...overAdriatic, zoom: Math.max(final.zoom - 1.3, 2.5), pitch: 45, bearing: -12 },
    legs: [{ to: end, durationMs: 1000 }],
    globe: null,
    totalMs: 1000,
  };
}

/**
 * When each stage of the grid lighting up begins, as a share of the flight (introStyle.ts says what each
 * stage shows). The last stage, "settle", begins once the camera has arrived.
 */
export const INTRO_STAGE_AT = [0, 0.28, 0.4, 0.52, 0.64, 0.72] as const;

/** After the camera arrives the flows run for a moment before everything settles. */
export const SETTLE_DELAY_MS = 150;
