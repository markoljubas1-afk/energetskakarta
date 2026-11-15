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
}

export const NOTHING_IN_VIEW: InView = { technologies: null, substances: null, extractionKinds: null };

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
  };
}

export function sameInView(a: InView, b: InView): boolean {
  const same = (x: ReadonlySet<string> | null, y: ReadonlySet<string> | null): boolean =>
    x === y || (x !== null && y !== null && x.size === y.size && [...x].every((v) => y.has(v)));
  return (
    same(a.technologies, b.technologies) &&
    same(a.substances, b.substances) &&
    same(a.extractionKinds, b.extractionKinds)
  );
}
