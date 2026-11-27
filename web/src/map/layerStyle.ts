/**
 * Expression helpers the map's layers share (Faza 26 split from layers.ts): colours by voltage, technology,
 * medium and substance, sizes by zoom, hover and the selection ring.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { SUBSTANCES, TECHNOLOGIES, VOLTAGE_CLASSES } from "../domain";
import { selectionFilter, voltageClassExpr } from "./filters";
import type { Palette } from "./palette";
import { LAYER_PREFIX } from "./sources";

export type Expr = ExpressionSpecification;

/**
 * ["match", input, label, output, ..., fallback]. TypeScript cannot type a spread `match`, so this is the
 * single place where the tuple is asserted; the unit tests validate every generated style with the
 * official MapLibre style validator.
 */
export function match(
  input: Expr,
  pairs: readonly (readonly [string, string | number])[],
  fallback: string | number,
): Expr {
  return ["match", input, ...pairs.flat(), fallback] as unknown as Expr;
}

export function voltageColor(palette: Palette): Expr {
  return match(
    voltageClassExpr,
    VOLTAGE_CLASSES.map((k) => [k, palette.voltage[k]] as const),
    palette.voltage.unknown,
  );
}

export function technologyColor(palette: Palette): Expr {
  return match(
    ["get", "technology"],
    TECHNOLOGIES.map((k) => [k, palette.technology[k]] as const),
    palette.technology.other,
  );
}

/**
 * Zoom-dependent sizes. MapLibre only allows ["zoom"] at the top level of an interpolate, so scaling and
 * offsets are applied inside every stop instead of wrapping the whole expression.
 */
export function byZoom(stops: readonly (readonly [number, Expr])[], scale = 1, add: number | Expr = 0): Expr {
  const outputs = stops.flatMap(([zoom, value]) => [zoom, ["+", add, ["*", scale, value]] as Expr]);
  return ["interpolate", ["exponential", 1.4], ["zoom"], ...outputs] as unknown as Expr;
}

export const LINE_WIDTH_STOPS = [
  [
    4,
    match(
      voltageClassExpr,
      [
        ["380+", 1.6],
        ["220-379", 1.1],
      ],
      0.7,
    ),
  ],
  [
    10,
    match(
      voltageClassExpr,
      [
        ["380+", 3.4],
        ["220-379", 2.6],
        ["110-219", 1.8],
      ],
      1.2,
    ),
  ],
  [
    15,
    match(
      voltageClassExpr,
      [
        ["380+", 6],
        ["220-379", 4.5],
        ["110-219", 3.2],
      ],
      2.2,
    ),
  ],
] as const;

/**
 * Radius ∝ √capacity, so area tracks MW; unknown capacity gets a small fixed dot. Capped, as cities are: at
 * the overview of the region the largest plants would otherwise cover their neighbours, and one wrong
 * figure in a source would cover a province (it did: a 21 GW "solar farm" near Ravenna).
 */
export function plantSize(factor: number, minimum: number, maximum: number): Expr {
  return [
    "case",
    ["has", "capacityMw"],
    ["min", maximum, ["max", minimum, ["*", factor, ["sqrt", ["get", "capacityMw"]]]]],
    minimum,
  ];
}
export const PLANT_RADIUS_STOPS = [
  [4, plantSize(0.35, 2, 13)],
  [10, plantSize(0.9, 3.5, 34)],
  [15, plantSize(1.6, 6, 64)],
] as const;

export const SUBSTATION_RADIUS_STOPS = [
  [6, match(voltageClassExpr, [["380+", 3]], 2)],
  [
    12,
    match(
      voltageClassExpr,
      [
        ["380+", 6],
        ["220-379", 5],
      ],
      4,
    ),
  ],
] as const;

/** Radius ∝ √power like plants, so the two are comparable; an unpublished power gets the small dot. */
export function datacenterSize(factor: number, minimum: number): Expr {
  return ["case", ["has", "powerMw"], ["max", minimum, ["*", factor, ["sqrt", ["get", "powerMw"]]]], minimum];
}
export const DATACENTER_RADIUS_STOPS = [
  [6, datacenterSize(0.7, 3.4)],
  [11, datacenterSize(1.4, 4.8)],
  [15, datacenterSize(2.4, 6.5)],
] as const;

/** `on` while the pointer rests on the feature (MapView sets the state), otherwise `off`. */
export function hovered(on: number | string, off: number | string | Expr): Expr {
  return ["case", ["boolean", ["feature-state", "hover"], false], on, off];
}
export const HOVER_LINE_BOOST = hovered(2.5, 0);

/** Linear zoom stops with the hover boost folded into every stop (see byZoom on why). */
export function lineWidthByZoom(stops: readonly (readonly [number, number])[]): Expr {
  const outputs = stops.flatMap(([zoom, width]) => [zoom, ["+", width, HOVER_LINE_BOOST] as Expr]);
  return ["interpolate", ["exponential", 1.4], ["zoom"], ...outputs] as unknown as Expr;
}

/** Circle stroke that turns into the selection colour on hover, over whatever it is at rest. */
export function hoverStroke(palette: Palette, width: number, color: string | Expr): Record<string, Expr> {
  return {
    "circle-stroke-width": hovered(2.6, width),
    "circle-stroke-color": hovered(palette.selection, color),
  };
}

/** Radius ∝ √(electricity MWh/year), capped so a metropolis does not swallow its neighbours. */
export function citySize(factor: number, minimum: number, maximum: number): Expr {
  return ["min", maximum, ["max", minimum, ["*", factor, ["sqrt", ["get", "electricityMwh"]]]]];
}
export const CITY_RADIUS_STOPS = [
  [5, citySize(0.012, 4, 22)],
  [9, citySize(0.03, 6, 46)],
  [14, citySize(0.08, 10, 120)],
] as const;

export const lineWidth = byZoom(LINE_WIDTH_STOPS, 1, HOVER_LINE_BOOST);
export const plantRadius = byZoom(PLANT_RADIUS_STOPS);
export const substationRadius = byZoom(SUBSTATION_RADIUS_STOPS);
export const datacenterRadius = byZoom(DATACENTER_RADIUS_STOPS);
export const cityRadius = byZoom(CITY_RADIUS_STOPS);

export const visible = (on: boolean): "visible" | "none" => (on ? "visible" : "none");

/** Every point layer's selection ring shares the id suffix, so the pulse in MapView can find them all. */
export const SELECTED_RING_SUFFIX = "-selected";
export const SELECTED_RING_STROKE = 3;

/**
 * The ring around a selected point: hollow, in the selection colour, a little wider than the point so
 * the point's own colour stays readable. One shape for every point layer, whatever its source.
 */
export function selectedRing(
  id: string,
  source: string,
  sourceLayer: string | undefined,
  radius: Expr,
  palette: Palette,
  selected: string | null,
  visibility: "visible" | "none" = "visible",
): LayerSpecification {
  return {
    id: `${LAYER_PREFIX}${id}${SELECTED_RING_SUFFIX}`,
    type: "circle",
    source,
    ...(sourceLayer !== undefined ? { "source-layer": sourceLayer } : {}),
    filter: selectionFilter(selected),
    layout: { visibility },
    paint: {
      "circle-radius": radius,
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": palette.selection,
      "circle-stroke-width": SELECTED_RING_STROKE,
    },
  };
}

// sqrt of kWh/d so area ~ energy: 1 GWh/d → 8 px, 25 GWh/d → 40 px, capped at 100 GWh/d
export const GAS_RADIUS: Expr = [
  "interpolate",
  ["linear"],
  ["sqrt", ["min", ["get", "latestKwh"], 100_000_000]],
  0,
  4,
  1000,
  8,
  5000,
  40,
  10_000,
  56,
];

// the same scale as the country's disc, so a point's circle can be held against it
export const GAS_FLOW_RADIUS: Expr = [
  "interpolate",
  ["linear"],
  ["sqrt", ["min", ["get", "kwh"], 100_000_000]],
  0,
  4,
  1000,
  8,
  5000,
  40,
  10_000,
  56,
];

/** A gas border arrow's width in pixels by the GWh that went across: thin when idle, broad at 400 GWh. */
export const GAS_BORDER_WIDTH: Expr = [
  "interpolate",
  ["linear"],
  ["get", "kwh"],
  0,
  1.5,
  25_000_000,
  3.5,
  100_000_000,
  6,
  400_000_000,
  10,
];

export function pipelineColor(palette: Palette): ExpressionSpecification {
  const c = palette.pipeline;
  return ["match", ["get", "medium"], "gas", c.gas, "oil", c.oil, "other", c.other, c.unknown];
}

export function substanceColor(palette: Palette): Expr {
  return match(
    ["get", "substance"],
    SUBSTANCES.map((k) => [k, palette.substance[k]] as const),
    palette.substance.unknown,
  );
}

/** Width of a live arc by MW, plus `extra` px for the halo and casing drawn under it. */
export const arcWidth = (extra: number): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["get", "mw"],
  0,
  1.5 + extra,
  500,
  4 + extra,
  1500,
  9 + extra,
];
