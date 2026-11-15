/**
 * The grid lighting up during the first-visit intro (Faza 22), as stages of the ordinary style. Every stage
 * shows the map's own data; nothing is invented. Paint changes between stages fade (INTRO_TRANSITION_MS),
 * and without an intro none of this is applied, so the style is exactly what it always was.
 *
 *   0 night:   a veil darkens the basemap, its labels wait; the borders of the region glow in the dark
 *   1 lines:   the lines appear, and "Hrvatska" over Croatia
 *   2 380 kV:  the highest voltage glows; the neighbours' names appear around it
 *   3 220 kV:  then 220 kV, and the cities give off light; the borders calm down
 *   4 110 kV:  then everything below
 *   5 points:  substations, plants and the other points; live flows, when there are any
 *   6 settle:  the glow calms to the theme's own, the cities' light, the flows and the names fade, the
 *              basemap's labels come back and the veil lifts
 */
import type { Feature, Point } from "geojson";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import type { CountryCode } from "../domain";
import { voltageClassExpr } from "./filters";
import { GRID_SOURCE, LAYER_PREFIX, LINE_GLOW_LAYER, PRICE_FILL_LAYER } from "./layers";
import type { Palette } from "./palette";

export type IntroStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const INTRO_SETTLE: IntroStage = 6;
/** Paint changes between stages fade this long. */
export const INTRO_TRANSITION_MS = 900;

const INTRO_PREFIX = `${LAYER_PREFIX}intro-`;
export const INTRO_NIGHT_LAYER = `${INTRO_PREFIX}night`;
export const INTRO_CITY_GLOW_LAYER = `${INTRO_PREFIX}city-glow`;
export const INTRO_REGION_LAYER = `${INTRO_PREFIX}region`;
const INTRO_NAMES_SOURCE = `${INTRO_PREFIX}names`;
const SCOPE_OUTLINE_LAYER = `${LAYER_PREFIX}scope-outline`;

/**
 * Where each country's name stands during the intro: a point well inside the country, clear of the coast.
 * Placement only; the names themselves come from i18n.
 */
export const COUNTRY_NAME_AT: Record<CountryCode, [number, number]> = {
  HR: [15.75, 45.05],
  SI: [14.8, 46.1],
  HU: [19.1, 47.1],
  RS: [20.8, 44.0],
  BA: [17.7, 44.25],
  ME: [19.25, 42.75],
  IT: [12.4, 43.1],
  AT: [14.3, 47.55],
};

/** One glow per voltage band, lit in turn; the classes are VOLTAGE_CLASSES. */
const GLOW_BANDS = [
  { id: `${INTRO_PREFIX}glow-380`, stage: 2, classes: ["380+"] },
  { id: `${INTRO_PREFIX}glow-220`, stage: 3, classes: ["220-379"] },
  { id: `${INTRO_PREFIX}glow-110`, stage: 4, classes: ["110-219", "60-109", "<60", "unknown"] },
] as const;

/** Drawn from the start: they frame the region in the dark. */
const ALWAYS = new Set([`${LAYER_PREFIX}outside-mask`, SCOPE_OUTLINE_LAYER]);

const OPACITY: Partial<Record<LayerSpecification["type"], readonly string[]>> = {
  line: ["line-opacity"],
  circle: ["circle-opacity", "circle-stroke-opacity"],
  fill: ["fill-opacity"],
  symbol: ["text-opacity", "icon-opacity"],
};

/** The stage from which a data layer is drawn, and the stage from which it is gone again (live flows). */
function shownBetween(layer: LayerSpecification): { from: number; until: number } {
  if (ALWAYS.has(layer.id)) return { from: 0, until: Infinity };
  // the price fill would colour whole countries for a moment only: kept out of the intro
  if (layer.id === PRICE_FILL_LAYER) return { from: Infinity, until: Infinity };
  if (layer.id.startsWith(`${LAYER_PREFIX}live-`)) return { from: 5, until: INTRO_SETTLE };
  // the theme's own glow returns when the intro's glows calm down
  if (layer.id === LINE_GLOW_LAYER) return { from: INTRO_SETTLE, until: Infinity };
  if (layer.type === "line") return { from: 1, until: Infinity };
  if (layer.type === "circle" || layer.type === "fill") return { from: 5, until: Infinity };
  return { from: INTRO_SETTLE, until: Infinity };
}

type Paint = Record<string, unknown>;
const paintOf = (layer: LayerSpecification): Paint => ("paint" in layer ? { ...layer.paint } : {});

/** The layer with its opacities at 0, or at their own values (1 where none is set). */
function staged(layer: LayerSpecification, shown: boolean): LayerSpecification {
  const props = OPACITY[layer.type];
  if (!props) return layer;
  const paint = paintOf(layer);
  for (const prop of props) paint[prop] = shown ? (paint[prop] ?? 1) : 0;
  // the paint keys are the type's own opacity properties, so the layer stays the same kind
  return { ...layer, paint };
}

function glowBands(glow: LayerSpecification, stage: IntroStage, palette: Palette): LayerSpecification[] {
  const paint = paintOf(glow);
  return GLOW_BANDS.map(
    (band) =>
      ({
        id: band.id,
        type: "line",
        source: GRID_SOURCE,
        "source-layer": "lines",
        filter: [
          "all",
          "filter" in glow && glow.filter ? glow.filter : true,
          ["match", voltageClassExpr, [...band.classes], true, false],
        ],
        layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": paint["line-color"],
          "line-width": paint["line-width"],
          "line-blur": paint["line-blur"],
          "line-opacity": stage >= band.stage && stage < INTRO_SETTLE ? palette.intro.glow : 0,
        },
      }) as unknown as LayerSpecification,
  );
}

/** Warm light where the electricity is used: radius ∝ √(yearly MWh), as the cities layer sizes its discs. */
function cityGlow(stage: IntroStage, palette: Palette): LayerSpecification {
  const size = (factor: number, min: number, max: number) => [
    "min",
    max,
    ["max", min, ["*", factor, ["sqrt", ["coalesce", ["get", "electricityMwh"], 0]]]],
  ];
  return {
    id: INTRO_CITY_GLOW_LAYER,
    type: "circle",
    source: GRID_SOURCE,
    "source-layer": "cities",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, size(0.012, 3, 18), 8, size(0.05, 10, 70)],
      "circle-color": palette.intro.cityGlow,
      "circle-blur": 1,
      "circle-opacity": stage >= 3 && stage < INTRO_SETTLE ? 0.55 : 0,
    },
  } as unknown as LayerSpecification;
}

/** The region's borders in warm light: bright while the camera comes in, calmer once the grid is lit. */
function regionGlow(outline: LayerSpecification, stage: IntroStage, palette: Palette): LayerSpecification {
  return {
    id: INTRO_REGION_LAYER,
    type: "line",
    source: "source" in outline ? outline.source : "",
    "source-layer": "countries",
    filter: "filter" in outline && outline.filter ? outline.filter : ["get", "inScope"],
    layout: { "line-join": "round" },
    paint: {
      "line-color": palette.intro.region,
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2, 6, 4, 10, 6],
      "line-blur": 3,
      "line-opacity": stage < 3 ? 0.85 : stage < INTRO_SETTLE ? 0.35 : 0,
    },
  } as unknown as LayerSpecification;
}

/** Our data layers at one stage of the intro, with the intro's own night, glows and city light added. */
export function introLayers(
  layers: readonly LayerSpecification[],
  stage: IntroStage,
  palette: Palette,
): LayerSpecification[] {
  const night = {
    id: INTRO_NIGHT_LAYER,
    type: "background",
    paint: {
      "background-color": palette.intro.night,
      "background-opacity": stage < INTRO_SETTLE ? palette.intro.veil : 0,
    },
  } as unknown as LayerSpecification;
  const out: LayerSpecification[] = [night, cityGlow(stage, palette)];
  for (const layer of layers) {
    const { from, until } = shownBetween(layer);
    if (layer.id === SCOPE_OUTLINE_LAYER) out.push(regionGlow(layer, stage, palette));
    out.push(staged(layer, stage >= from && stage < until));
    if (layer.id === LINE_GLOW_LAYER) out.push(...glowBands(layer, stage, palette));
  }
  return out;
}

type Projection = NonNullable<StyleSpecification["projection"]>;
type Sky = NonNullable<StyleSpecification["sky"]>;

export interface IntroStyleOptions {
  stage: IntroStage;
  /** zooms between which the globe becomes the flat map, or null for a flat flight */
  globe: { from: number; to: number } | null;
  palette: Palette;
  /** the countries' names in the reader's language and the basemap's fonts; null without glyphs */
  names: { label: Record<CountryCode, string>; fonts: string[] } | null;
}

/** "Hrvatska" first and larger, then its neighbours. */
function nameLayers(
  names: NonNullable<IntroStyleOptions["names"]>,
  stage: IntroStage,
  palette: Palette,
): LayerSpecification[] {
  const layer = (home: boolean, from: number, size: [number, number]): LayerSpecification =>
    ({
      id: `${INTRO_PREFIX}names-${home ? "home" : "region"}`,
      type: "symbol",
      source: INTRO_NAMES_SOURCE,
      filter: ["==", ["get", "home"], home],
      layout: {
        "text-field": ["get", "name"],
        "text-font": names.fonts,
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, size[0], 6, size[1]],
        "text-letter-spacing": 0.02,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": palette.intro.ink,
        "text-halo-color": palette.intro.night,
        "text-halo-width": 1.6,
        "text-halo-blur": 1,
        "text-opacity": stage >= from && stage < INTRO_SETTLE ? 1 : 0,
      },
    }) as unknown as LayerSpecification;
  return [layer(false, 2, [12, 16]), layer(true, 1, [16, 24])];
}

/**
 * While the intro plays: the globe that turns into the flat map between two zooms, sky around it, the
 * basemap's labels held back for the night and the region's names instead, and slower fades. Without the
 * intro none of this is set, as before.
 */
export function introStyle(style: StyleSpecification, options: IntroStyleOptions): StyleSpecification {
  const { stage, globe, palette, names } = options;
  const sky: Sky = {
    "sky-color": palette.intro.sky,
    "horizon-color": palette.intro.horizon,
    "fog-color": palette.intro.night,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.8,
    "fog-ground-blend": 0.9,
    "atmosphere-blend": 0.8,
  };
  const projection = globe
    ? ({
        type: ["interpolate", ["linear"], ["zoom"], globe.from, "vertical-perspective", globe.to, "mercator"],
      } as unknown as Projection)
    : null;
  // the basemap's own labels (towns, countries) wait for the night to lift
  const layers = style.layers.map((layer) =>
    layer.id.startsWith(LAYER_PREFIX) || layer.type !== "symbol"
      ? layer
      : staged(layer, stage >= INTRO_SETTLE),
  );
  const sources = { ...style.sources };
  if (names) {
    const features = (Object.keys(COUNTRY_NAME_AT) as CountryCode[]).map((code): Feature<Point> => ({
      type: "Feature",
      properties: { name: names.label[code], home: code === "HR" },
      geometry: { type: "Point", coordinates: COUNTRY_NAME_AT[code] },
    }));
    sources[INTRO_NAMES_SOURCE] = { type: "geojson", data: { type: "FeatureCollection", features } };
    layers.push(...nameLayers(names, stage, palette));
  }
  return {
    ...style,
    sources,
    layers,
    ...(projection ? { projection } : {}),
    sky,
    transition: { duration: INTRO_TRANSITION_MS, delay: 0 },
  };
}
