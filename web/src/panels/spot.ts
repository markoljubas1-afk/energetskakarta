import type { Spotlight } from "../map/spotlight";

/** Pointer handlers for a legend or overview row: the row lights its kind on the map while pointed at. */
export function spotHandlers(
  onSpotlight: ((spotlight: Spotlight) => void) | undefined,
  spotlight: Exclude<Spotlight, null>,
): { onPointerEnter?: () => void; onPointerLeave?: () => void } {
  if (!onSpotlight) return {};
  return {
    onPointerEnter: () => {
      onSpotlight(spotlight);
    },
    onPointerLeave: () => {
      onSpotlight(null);
    },
  };
}
