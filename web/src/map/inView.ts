/**
 * Which kinds of things are on screen right now, so the legend can play down the ones that are not.
 * Read from the rendered features on `idle`; a layer that is not drawn reports nothing, and the legend
 * then leaves that list alone rather than dimming all of it.
 */
import type { Map as MapLibreMap } from "maplibre-gl";

import {
  EXTRACTION_KINDS,
  SUBSTANCES,
  TECHNOLOGIES,
  type ExtractionKind,
  type LayerKey,
  type Substance,
  type Technology,
  isOneOf,
} from "../domain";
import { LAYER_PREFIX } from "./layers";

export interface InView {
  /** null when the plants layer is not drawn */
  technologies: ReadonlySet<Technology> | null;
  /** null when the extraction layer is not drawn */
  substances: ReadonlySet<Substance> | null;
  extractionKinds: ReadonlySet<ExtractionKind> | null;
  /**
   * Layers that are switched on and drawn, but have nothing on screen: the map is too far out for them
   * (cities, chargers and the distribution network wait for a closer view) or there is none here. The
   * layer list says so, instead of leaving a ticked box next to an empty map.
   */
  emptyLayers: ReadonlySet<LayerKey>;
  /** west, south, east, north of what is on screen; null until the map has settled once */
  bounds: [number, number, number, number] | null;
}

export const NOTHING_IN_VIEW: InView = {
  technologies: null,
  substances: null,
  extractionKinds: null,
  emptyLayers: new Set(),
  bounds: null,
};

/** Three decimals (about 100 m): finer than anything the overview adds up, and stable between idles. */
const coordinate = (value: number): number => Math.round(value * 1000) / 1000;

/** The style layers that draw each layer of the list (those served as tiles, which have zoom thresholds). */
const DRAWN_BY: Partial<Record<LayerKey, readonly string[]>> = {
  lines: ["lines", "lines-planned", "interconnectors"],
  substations: ["substations", "substations-planned"],
  plants: ["plants", "plants-planned"],
  pipelines: ["pipelines", "pipelines-planned"],
  datacenters: ["datacenters", "datacenters-planned"],
  cities: ["cities"],
  distribution: ["distribution-lines", "distribution-substations"],
  chargers: ["chargers", "chargers-overview"],
  extraction: ["extraction"],
};

/**
 * Whether the map shows nothing at all of what is switched on (Faza 57-C2): every layer that is on is one the
 * map can count (drawn from tiles) and has nothing in view. With a layer it cannot count (solar potential,
 * gas…) it does not say so (nor with the live flows, which are not a layer: App.tsx), and with nothing switched on there is nothing to say.
 */
export function nothingShown(layers: ReadonlySet<LayerKey>, empty: ReadonlySet<LayerKey>): boolean {
  if (layers.size === 0) return false;
  return [...layers].every((layer) => DRAWN_BY[layer] !== undefined && empty.has(layer));
}

function emptyLayers(map: MapLibreMap): ReadonlySet<LayerKey> {
  const empty = new Set<LayerKey>();
  for (const [key, names] of Object.entries(DRAWN_BY) as [LayerKey, readonly string[]][]) {
    const shown = names
      .map((name) => `${LAYER_PREFIX}${name}`)
      .filter((id) => map.getLayer(id) !== undefined && map.getLayoutProperty(id, "visibility") !== "none");
    if (shown.length > 0 && map.queryRenderedFeatures({ layers: shown }).length === 0) empty.add(key);
  }
  return empty;
}

function values<T extends string>(
  map: MapLibreMap,
  layers: readonly string[],
  property: string,
  known: readonly T[],
): ReadonlySet<T> | null {
  const present = layers.filter((id) => map.getLayer(id) !== undefined);
  if (present.length === 0) return null;
  const found = new Set<T>();
  for (const feature of map.queryRenderedFeatures({ layers: present })) {
    const value: unknown = feature.properties[property];
    if (isOneOf(known, value)) found.add(value);
  }
  return found;
}

export function inView(map: MapLibreMap): InView {
  return {
    technologies: values(
      map,
      [`${LAYER_PREFIX}plants`, `${LAYER_PREFIX}plants-planned`],
      "technology",
      TECHNOLOGIES,
    ),
    substances: values(map, [`${LAYER_PREFIX}extraction`], "substance", SUBSTANCES),
    extractionKinds: values(map, [`${LAYER_PREFIX}extraction`], "kind", EXTRACTION_KINDS),
    emptyLayers: emptyLayers(map),
    bounds: [
      coordinate(map.getBounds().getWest()),
      coordinate(map.getBounds().getSouth()),
      coordinate(map.getBounds().getEast()),
      coordinate(map.getBounds().getNorth()),
    ],
  };
}

export function sameInView(a: InView, b: InView): boolean {
  const same = (x: ReadonlySet<string> | null, y: ReadonlySet<string> | null): boolean =>
    x === y || (x !== null && y !== null && x.size === y.size && [...x].every((v) => y.has(v)));
  return (
    same(a.technologies, b.technologies) &&
    same(a.substances, b.substances) &&
    same(a.extractionKinds, b.extractionKinds) &&
    same(a.emptyLayers, b.emptyLayers) &&
    (a.bounds === b.bounds ||
      (a.bounds !== null &&
        b.bounds !== null &&
        a.bounds.every((value, index) => value === b.bounds?.[index])))
  );
}
