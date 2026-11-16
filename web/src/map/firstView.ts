/**
 * What the map opens on. A wide screen shows the whole region. A phone held upright cannot: the region is
 * wider than it is tall, so fitting its width left half of the screen to Germany and Tunisia and shrank the
 * grid to a strip in the middle. A phone opens on Croatia, which the map is named after, with the neighbours
 * around its edges; the rest is one pinch away.
 */
export type Bounds = [west: number, south: number, east: number, north: number];

/** Croatia with a margin: the Slovenian and Hungarian border in the north, the Montenegrin coast in the south. */
export const HOME_BOUNDS: Bounds = [13.2, 42.2, 19.6, 46.7];

/** The phone layout's breakpoint (App.module.css). */
export const PHONE_MAX_WIDTH_PX = 720;

export function firstViewBounds(region: Bounds, widthPx: number, heightPx: number): Bounds {
  if (widthPx > PHONE_MAX_WIDTH_PX || heightPx <= widthPx) return region;
  const home: Bounds = [
    Math.max(region[0], HOME_BOUNDS[0]),
    Math.max(region[1], HOME_BOUNDS[1]),
    Math.min(region[2], HOME_BOUNDS[2]),
    Math.min(region[3], HOME_BOUNDS[3]),
  ];
  // data that does not reach Croatia (a build of other countries only) keeps its own extent
  return home[0] < home[2] && home[1] < home[3] ? home : region;
}
