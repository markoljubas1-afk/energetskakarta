/**
 * The credits line in the map's corner (Faza 56, 4.2). It names the sources of what is shown, so it changes
 * when a layer with its own source comes on (gas: ENTSOG, GIE) and when the language changes. MapLibre has
 * no public way to change the text of its AttributionControl, so the control is replaced.
 */
import { AttributionControl, ScaleControl, type IControl, type Map as MapLibreMap } from "maplibre-gl";

/** Below this width the credits start folded behind the (i) button, as phone users expect. */
export const COMPACT_CREDITS_MAX_WIDTH = 640;

type CreditsMap = Pick<MapLibreMap, "addControl" | "removeControl" | "hasControl" | "getContainer">;

export interface CreditControls {
  credits: (text: string) => IControl;
  scale: () => IControl;
}

const MAPLIBRE: CreditControls = {
  credits: (text) => new AttributionControl({ compact: true, customAttribution: text }),
  scale: () => new ScaleControl({ unit: "metric" }),
};

/**
 * Show `text` as the credits, with the scale above them, and return what takes both away again. Bottom
 * controls stack upwards from the last one added, so the credits go in first to stay under the scale, and the
 * scale is replaced with them to keep that order.
 */
export function showCredits(map: CreditsMap, text: string, controls: CreditControls = MAPLIBRE): () => void {
  const credits = controls.credits(text);
  const scale = controls.scale();
  map.addControl(credits, "bottom-right");
  map.addControl(scale, "bottom-right");
  return () => {
    // the map may be gone already (it removes its own controls)
    if (map.hasControl(scale)) map.removeControl(scale);
    if (map.hasControl(credits)) map.removeControl(credits);
  };
}

/**
 * MapLibre opens compact credits and folds them on the first drag; on a narrow map they start folded behind
 * the (i) button instead, which the licences allow and which leaves the short map free.
 */
export function foldCreditsWhenNarrow(map: Pick<MapLibreMap, "getContainer">): void {
  const container = map.getContainer();
  if (container.clientWidth > COMPACT_CREDITS_MAX_WIDTH) return;
  const open = container.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
  open?.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-button")?.click();
}
