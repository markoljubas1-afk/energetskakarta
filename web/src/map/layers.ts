/** Layers for our own data, built from state + theme; merged into whichever basemap is active. */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import type { CountryCode, LayerKey } from "../domain";
import { en } from "../i18n/en";
import { hr } from "../i18n/hr";
import {
  chargerFilter,
  cityFilter,
  dataCenterFilter,
  distributionLineFilter,
  distributionSubstationFilter,
  extractionFilter,
  lineFilter,
  pipelineFilter,
  plantFilter,
  selectionFilter,
  substationFilter,
  type StyleState,
} from "./filters";
import { stepPattern } from "./flowAnimation";
import {
  CITY_RADIUS_STOPS,
  DATACENTER_RADIUS_STOPS,
  GAS_FLOW_RADIUS,
  GAS_RADIUS,
  LINE_WIDTH_STOPS,
  PLANT_RADIUS_STOPS,
  SUBSTATION_RADIUS_STOPS,
  arcWidth,
  byZoom,
  cityRadius,
  datacenterRadius,
  hoverStroke,
  hovered,
  lineWidth,
  lineWidthByZoom,
  pipelineColor,
  plantRadius,
  selectedRing,
  substanceColor,
  substationRadius,
  technologyColor,
  visible,
  voltageColor,
  type Expr,
} from "./layerStyle";
import { gridOpacity, plantOpacity, TIME_MACHINE_GRID, type Spotlight } from "./spotlight";
import type { Band } from "../data/greenShare";
import type { Around } from "../data/nearby";
import type { Palette } from "./palette";
import { priceFill } from "./priceScale";
import {
  BOUNDARY_SOURCE,
  CAPACITY_LAYER,
  GAS_FLOW_LAYER,
  GAS_FLOW_SOURCE,
  GAS_STORAGE_LAYER,
  GAS_STORAGE_SOURCE,
  CHARGER_OVERVIEW_LAYER,
  CAPACITY_SOURCE,
  CHARGER_OVERVIEW_SOURCE,
  CHARGER_SOURCE,
  DISTRIBUTION_SOURCE,
  EXTRACTION_SOURCE,
  FLOW_CASING_LAYER,
  FLOW_DASH_LAYER,
  FLOW_HALO_LAYER,
  GAS_SOURCE,
  GEOTHERMAL_SITES_LAYER,
  GEOTHERMAL_SOURCE,
  GRID_SOURCE,
  LAYER_PREFIX,
  LINE_GLOW_LAYER,
  LIVE_SOURCE,
  PRICE_FILL_LAYER,
  SOLAR_SOURCE,
  TIMELINE_SOURCE,
  TRAVEL_SOURCE,
  type OptIn,
} from "./sources";

// Everything other modules have always imported from here stays importable from here.
export {
  BOUNDARY_SOURCE,
  CAPACITY_LAYER,
  CAPACITY_SOURCE,
  CHARGER_OVERVIEW_LAYER,
  CHARGER_OVERVIEW_SOURCE,
  GAS_FLOW_LAYER,
  GAS_FLOW_SOURCE,
  GAS_STORAGE_LAYER,
  GAS_STORAGE_SOURCE,
  CHARGER_SOURCE,
  dataSources,
  DISTRIBUTION_SOURCE,
  EXTRACTION_SOURCE,
  FEATURE_ID,
  FLOW_CASING_LAYER,
  FLOW_DASH_LAYER,
  FLOW_HALO_LAYER,
  GAS_SOURCE,
  GEOTHERMAL_SITES_LAYER,
  GEOTHERMAL_SOURCE,
  GRID_SOURCE,
  INTERACTIVE_LAYERS,
  LAYER_PREFIX,
  LINE_GLOW_LAYER,
  LIVE_SOURCE,
  NOTHING_OPTED_IN,
  OPT_IN_ARCHIVES,
  optedIn,
  PRICE_FILL_LAYER,
  SELECTABLE,
  SOLAR_SOURCE,
  TIMELINE_SOURCE,
  TRAVEL_SOURCE,
  type OptIn,
  type OptInArchive,
  type OptionalArchive,
  type Overlays,
  type TileUrls,
} from "./sources";
export { SELECTED_RING_STROKE, SELECTED_RING_SUFFIX } from "./layerStyle";

export interface LayerOptions {
  /** only what the style is made of (StyleState): a pan changes nothing here */
  state: StyleState;
  palette: Palette;
  /** Whether the basemap provides glyphs; labels are only added when it does. */
  labels: string[] | null;
  /** Dim countries outside the selected scope (on top of a detailed basemap). */
  maskOutside: boolean;
  /** Which opt-in archives to draw: switch on and archive published (see `optedIn`). */
  optIn: OptIn;
  /** Day-ahead prices at the live layer's hour (EUR/MWh per country); the countries are filled by them. */
  livePrices?: Partial<Record<CountryCode, number>> | null;
  /** one technology or voltage lit, the rest receding (spotlight.ts); null: everything as it is */
  spotlight?: Spotlight;
  /**
   * The zoom from which single charging stations are in the tiles; below it they are drawn added up by
   * cell. Null when the build has no such overview: then nothing is drawn below that zoom, as before.
   */
  chargerOverviewBelow?: number | null;
  /** the grid next to the selected plant (data/nearby.ts): its substation and lines are lit; null: nothing */
  around?: Around | null;
  /** the solar potential picture is declared as a source (layer on and published): draw it */
  solar?: boolean;
  /**
   * How green each country's electricity is right now (data/greenShare.ts): charging stations are
   * coloured by their country's band. Null or a country left out: the plain charger colour.
   */
  chargerBands?: Record<string, Band> | null;
}

export function dataLayers({
  state,
  palette,
  labels,
  maskOutside,
  optIn,
  livePrices = null,
  spotlight = null,
  chargerOverviewBelow = null,
  around = null,
  solar = false,
  chargerBands = null,
}: LayerOptions): LayerSpecification[] {
  // the few words the style itself writes on the map
  const words = state.lang === "en" ? en : hr;
  // Added only while something is lit or the time machine runs: otherwise the style is exactly what it
  // always was. A spotlight wins over the time machine: it is the reader's own, momentary question.
  const gridReceded = spotlight !== null || state.year !== null;
  const gridShare = (full: number) =>
    spotlight !== null ? gridOpacity(spotlight, full) : Math.round(full * TIME_MACHINE_GRID * 1000) / 1000;
  const lineLight = gridReceded ? { "line-opacity": gridShare(1) } : {};
  const gridMarkLight = (fill: number) =>
    gridReceded ? { "circle-opacity": gridShare(fill), "circle-stroke-opacity": gridShare(1) } : {};
  const plantLight = (fill: number) =>
    spotlight === null
      ? {}
      : {
          "circle-opacity": plantOpacity(spotlight, fill),
          "circle-stroke-opacity": plantOpacity(spotlight, 1),
        };
  const { distribution: showDistribution, chargers: showChargers, extraction: showExtraction } = optIn;
  const show = (key: LayerKey) => visible(state.layers.has(key));
  const layers: LayerSpecification[] = [];

  // Solar potential: a picture under everything else, see-through enough for borders and coast to
  // show, so lines and plants are read on top of it.
  if (solar) {
    layers.push({
      id: `${LAYER_PREFIX}solar`,
      type: "raster",
      source: SOLAR_SOURCE,
      paint: { "raster-opacity": 0.72, "raster-fade-duration": 0 },
    });
  }

  if (maskOutside) {
    layers.push({
      id: `${LAYER_PREFIX}outside-mask`,
      type: "fill",
      source: BOUNDARY_SOURCE,
      "source-layer": "countries",
      filter: ["!", ["get", "inScope"]],
      paint: { "fill-color": palette.outsideMask },
    });
  }
  // Prices colour the countries under everything else, only while the live layer is on (Faza 18-2).
  const fill = state.live && livePrices ? priceFill(livePrices, palette.price.stops) : null;
  layers.push({
    id: PRICE_FILL_LAYER,
    type: "fill",
    source: BOUNDARY_SOURCE,
    "source-layer": "countries",
    filter: ["get", "inScope"],
    layout: { visibility: visible(fill !== null) },
    paint: { "fill-color": fill ?? "rgba(0, 0, 0, 0)", "fill-opacity": palette.price.opacity },
  });
  // Geothermal potential (Faza 21): heat-flow cells under the grid, translucent, only near measurements.
  const heatStops = palette.heatFlow.stops.flatMap(([q, color]) => [q, color]);
  layers.push({
    id: `${LAYER_PREFIX}geothermal-potential`,
    type: "fill",
    source: GEOTHERMAL_SOURCE,
    filter: ["==", ["geometry-type"], "Polygon"],
    layout: { visibility: show("geothermal") },
    paint: {
      "fill-color": ["interpolate", ["linear"], ["get", "q"], ...heatStops] as ExpressionSpecification,
      "fill-opacity": palette.heatFlow.opacity,
      "fill-antialias": false,
    },
  });
  layers.push({
    id: `${LAYER_PREFIX}scope-outline`,
    type: "line",
    source: BOUNDARY_SOURCE,
    "source-layer": "countries",
    filter: ["get", "inScope"],
    paint: {
      "line-color": palette.border,
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 10, 1.6],
    },
  });

  // The distribution network sits underneath everything: it is context for the grid, never the subject.
  // Its source is only declared for builds that publish the archive, so its layers follow the same rule.
  if (showDistribution) {
    layers.push(
      {
        id: `${LAYER_PREFIX}distribution-lines`,
        type: "line",
        source: DISTRIBUTION_SOURCE,
        "source-layer": "distribution_lines",
        filter: distributionLineFilter(state),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": voltageColor(palette),
          // thin, because a real distribution network is dense; opaque, so a single line is still legible
          "line-opacity": 0.9,
          "line-width": lineWidthByZoom([
            [10, 0.7],
            [14, 1.9],
          ]),
        },
      },
      {
        id: `${LAYER_PREFIX}distribution-lines-selected`,
        type: "line",
        source: DISTRIBUTION_SOURCE,
        "source-layer": "distribution_lines",
        filter: selectionFilter(state.selected),
        layout: { "line-cap": "round" },
        paint: { "line-color": palette.selection, "line-width": 6, "line-opacity": 0.55 },
      },
      {
        id: `${LAYER_PREFIX}distribution-substations`,
        type: "circle",
        source: DISTRIBUTION_SOURCE,
        "source-layer": "distribution_substations",
        filter: distributionSubstationFilter(state),
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.8, 14, 3.4],
          "circle-color": voltageColor(palette),
          "circle-opacity": 0.8,
          ...hoverStroke(palette, 0, voltageColor(palette)),
        },
      },
      {
        id: `${LAYER_PREFIX}distribution-substations-selected`,
        type: "circle",
        source: DISTRIBUTION_SOURCE,
        "source-layer": "distribution_substations",
        filter: selectionFilter(state.selected),
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 14, 7],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": palette.selection,
          "circle-stroke-width": 3,
        },
      },
    );
  }

  // one colour per country that has a fresh figure; the others keep the plain charger colour
  const [firstBand, ...otherBands] = Object.entries(chargerBands ?? {});
  const chargerColour: ExpressionSpecification | string =
    firstBand === undefined
      ? palette.charger
      : [
          "match",
          ["get", "country"],
          firstBand[0],
          palette.green[firstBand[1]],
          ...otherBands.flatMap(([country, band]) => [country, palette.green[band]]),
          palette.charger,
        ];
  if (showChargers && chargerOverviewBelow !== null) {
    // Below the zoom where stations are drawn one by one: a disc per cell and country, its area growing
    // with the number of stations. Discs are small while cells are small on screen and translucent, so
    // dense regions read as denser, not as a pile.
    const size: ExpressionSpecification = [
      "interpolate",
      ["linear"],
      ["sqrt", ["get", "count"]],
      1,
      4,
      30,
      26,
    ];
    layers.push({
      id: CHARGER_OVERVIEW_LAYER,
      type: "circle",
      source: CHARGER_OVERVIEW_SOURCE,
      maxzoom: chargerOverviewBelow,
      filter: chargerFilter(state),
      paint: {
        // a cell doubles in width with every zoom level; its disc grows more slowly, so it never fills it
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          ["*", 0.45, size],
          8,
          ["*", 1.2, size],
          11,
          ["*", 2.6, size],
        ],
        "circle-color": chargerColour,
        "circle-opacity": 0.6,
        "circle-stroke-color": chargerColour,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.9,
      },
    });
    if (labels) {
      layers.push({
        id: `${LAYER_PREFIX}chargers-overview-count`,
        type: "symbol",
        source: CHARGER_OVERVIEW_SOURCE,
        // from the zoom at which a cell is wide enough on screen for its number
        minzoom: 8,
        maxzoom: chargerOverviewBelow,
        filter: chargerFilter(state),
        layout: {
          "text-field": ["number-format", ["get", "count"], { locale: state.lang }],
          "text-font": labels,
          "text-size": 11,
        },
        paint: {
          "text-color": palette.labelText,
          "text-halo-color": palette.labelHalo,
          "text-halo-width": 1.2,
        },
      });
    }
  }

  if (showChargers) {
    layers.push({
      id: `${LAYER_PREFIX}chargers`,
      type: "circle",
      source: CHARGER_SOURCE,
      "source-layer": "chargers",
      filter: chargerFilter(state),
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 15, 4.5],
        "circle-color": chargerColour,
        "circle-opacity": 0.9,
        ...hoverStroke(palette, 0.8, palette.casing),
      },
    });
    layers.push(
      selectedRing(
        "chargers",
        CHARGER_SOURCE,
        "chargers",
        ["interpolate", ["linear"], ["zoom"], 11, 6, 15, 8.5],
        palette,
        state.selected,
      ),
    );
  }

  if (showExtraction) {
    // Discs coloured by substance, larger for a platform, mine or open pit than for a single well or
    // shaft: the map says where something is dug, never how much (the layer has no production figures).
    layers.push({
      id: `${LAYER_PREFIX}extraction`,
      type: "circle",
      source: EXTRACTION_SOURCE,
      "source-layer": "extraction",
      filter: extractionFilter(state),
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          ["match", ["get", "kind"], "platform", 3.5, "mine", 3, 2],
          14,
          ["match", ["get", "kind"], "platform", 8, "mine", 7, "quarry", 7, 5],
        ],
        "circle-color": substanceColor(palette),
        "circle-opacity": ["match", ["get", "kind"], "well", 0.85, "shaft", 0.85, "adit", 0.85, 0.95],
        "circle-stroke-color": palette.casing,
        "circle-stroke-width": hovered(1.8, 0.6),
      },
    });
    layers.push(
      selectedRing(
        "extraction",
        EXTRACTION_SOURCE,
        "extraction",
        ["interpolate", ["linear"], ["zoom"], 6, 7, 14, 12],
        palette,
        state.selected,
      ),
    );
  }

  // Cities sit under the grid: translucent discs whose area tracks yearly electricity, so a reader sees
  // where consumption is without the discs hiding the plants and lines drawn on top of them.
  layers.push(
    {
      id: `${LAYER_PREFIX}cities`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "cities",
      filter: cityFilter(state),
      layout: { visibility: show("cities"), "circle-sort-key": ["-", ["get", "electricityMwh"]] },
      paint: {
        "circle-radius": cityRadius,
        "circle-color": palette.city,
        ...hoverStroke(palette, 1.2, palette.cityRing),
      },
    },
    {
      id: `${LAYER_PREFIX}cities-selected`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "cities",
      filter: selectionFilter(state.selected),
      layout: { visibility: show("cities") },
      paint: {
        "circle-radius": byZoom(CITY_RADIUS_STOPS, 1, 3),
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.selection,
        "circle-stroke-width": 3,
      },
    },
  );

  // Lines: casing and interconnector halo underneath, then planned (dashed), then operating.
  layers.push(
    // offshore pipelines under the power grid: brown family, dashed when not in operation
    {
      id: `${LAYER_PREFIX}pipelines-planned`,
      type: "line",
      source: GRID_SOURCE,
      "source-layer": "pipelines",
      filter: pipelineFilter(state, false),
      layout: { visibility: show("pipelines") },
      paint: {
        "line-color": pipelineColor(palette),
        "line-width": hovered(4.5, 2),
        "line-dasharray": [1.5, 1.5],
      },
    },
    {
      id: `${LAYER_PREFIX}pipelines`,
      type: "line",
      source: GRID_SOURCE,
      "source-layer": "pipelines",
      filter: pipelineFilter(state, true),
      layout: { visibility: show("pipelines"), "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": pipelineColor(palette),
        "line-width": lineWidthByZoom([
          [5, 1.5],
          [10, 3.5],
        ]),
      },
    },
    {
      id: `${LAYER_PREFIX}pipelines-selected`,
      type: "line",
      source: GRID_SOURCE,
      "source-layer": "pipelines",
      filter: selectionFilter(state.selected),
      layout: { "line-cap": "round" },
      paint: { "line-color": palette.selection, "line-width": 7, "line-opacity": 0.55 },
    },
    {
      // Night glow (Faza 18-4): in the muted dark theme lines sit on a soft halo of their own colour. It is
      // the same theme, not a new one; the light theme has no glow (palette.lineGlow = 0).
      id: LINE_GLOW_LAYER,
      type: "line",
      source: GRID_SOURCE,
      "source-layer": "lines",
      filter: lineFilter(state, true),
      layout: {
        visibility: visible(state.layers.has("lines") && palette.lineGlow > 0),
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": voltageColor(palette),
        "line-width": byZoom(LINE_WIDTH_STOPS, 4),
        "line-blur": byZoom(LINE_WIDTH_STOPS, 3),
        "line-opacity": gridReceded ? gridShare(palette.lineGlow) : palette.lineGlow,
      },
    },
    {
      id: `${LAYER_PREFIX}interconnectors`,
      type: "line",
      source: GRID_SOURCE,
      "source-layer": "lines",
      filter: ["all", ["get", "isInterconnector"], lineFilter(state, true)],
      layout: { visibility: show("lines"), "line-cap": "round" },
      paint: {
        "line-color": palette.interconnector,
        "line-width": byZoom(LINE_WIDTH_STOPS, 3.2),
        ...lineLight,
      },
    },
    {
      id: `${LAYER_PREFIX}lines-planned`,
      type: "line",
      source: GRID_SOURCE,
      "source-layer": "lines",
      filter: lineFilter(state, false),
      layout: { visibility: show("lines") },
      paint: {
        "line-color": voltageColor(palette),
        "line-width": lineWidth,
        "line-dasharray": [2, 2],
        ...lineLight,
      },
    },
    {
      id: `${LAYER_PREFIX}lines`,
      type: "line",
      source: GRID_SOURCE,
      "source-layer": "lines",
      filter: lineFilter(state, true),
      layout: { visibility: show("lines"), "line-cap": "round", "line-join": "round" },
      paint: { "line-color": voltageColor(palette), "line-width": lineWidth, ...lineLight },
    },
    {
      id: `${LAYER_PREFIX}lines-selected`,
      type: "line",
      source: GRID_SOURCE,
      "source-layer": "lines",
      filter: selectionFilter(state.selected),
      layout: { "line-cap": "round" },
      paint: {
        "line-color": palette.selection,
        "line-width": byZoom(LINE_WIDTH_STOPS, 1, 4),
        "line-opacity": 0.55,
      },
    },
  );

  // Hover thickens the ring and turns it the selection colour; the fill is left alone so the
  // technology or voltage colour stays readable under the pointer.
  const hollow = (color: string | Expr) => ({
    "circle-opacity": 0.15,
    ...hoverStroke(palette, 1.6, color),
  });
  const solid = { "circle-opacity": 0.92, ...hoverStroke(palette, 1, palette.casing) };

  layers.push(
    {
      id: `${LAYER_PREFIX}substations-planned`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "substations",
      filter: substationFilter(state, false),
      layout: { visibility: show("substations") },
      paint: {
        "circle-radius": substationRadius,
        "circle-color": voltageColor(palette),
        ...hollow(voltageColor(palette)),
        ...gridMarkLight(0.15),
      },
    },
    {
      id: `${LAYER_PREFIX}substations`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "substations",
      filter: substationFilter(state, true),
      layout: { visibility: show("substations") },
      paint: {
        "circle-radius": substationRadius,
        "circle-color": voltageColor(palette),
        ...solid,
        ...gridMarkLight(0.92),
      },
    },
    // A halo under the running plants (2026-11-16), like the one under the lines and the data centres: in
    // the dark theme a plant is a light, not only a dot. Its own technology colour, blurred; a spotlight
    // dims it with its plant. The light theme has no glow anywhere (palette.plantGlow is 0 there).
    ...(palette.plantGlow > 0
      ? [
          {
            id: `${LAYER_PREFIX}plants-glow`,
            type: "circle",
            source: GRID_SOURCE,
            "source-layer": "plants",
            filter: plantFilter(state, true),
            layout: { visibility: show("plants") },
            paint: {
              "circle-radius": byZoom(PLANT_RADIUS_STOPS, 2.2, 4),
              "circle-color": technologyColor(palette),
              "circle-blur": 1,
              "circle-opacity": plantOpacity(spotlight, palette.plantGlow),
            },
          } satisfies LayerSpecification,
        ]
      : []),
    {
      id: `${LAYER_PREFIX}plants-planned`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "plants",
      filter: plantFilter(state, false),
      layout: {
        visibility: show("plants"),
        "circle-sort-key": ["-", ["coalesce", ["get", "capacityMw"], 0]],
      },
      paint: {
        "circle-radius": plantRadius,
        "circle-color": technologyColor(palette),
        ...hollow(technologyColor(palette)),
        ...plantLight(0.15),
      },
    },
    {
      id: `${LAYER_PREFIX}plants`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "plants",
      filter: plantFilter(state, true),
      // small plants drawn last so they stay clickable on top of large ones
      layout: {
        visibility: show("plants"),
        "circle-sort-key": ["-", ["coalesce", ["get", "capacityMw"], 0]],
      },
      paint: {
        "circle-radius": plantRadius,
        "circle-color": technologyColor(palette),
        ...solid,
        ...plantLight(0.92),
      },
    },
    // Time machine (Faza 18-3): plants GEM lists as retired, from the timeline. While they ran they look
    // like any plant; once closed they stay as grey outlines, unlike the coloured rings of planned plants.
    {
      id: `${LAYER_PREFIX}timeline-closed`,
      type: "circle",
      source: TIMELINE_SOURCE,
      filter: ["==", ["get", "phase"], "closed"],
      layout: { visibility: visible(state.year !== null && state.layers.has("plants")) },
      paint: {
        "circle-radius": plantRadius,
        "circle-opacity": 0,
        "circle-stroke-color": palette.border,
        "circle-stroke-width": 1.4,
        "circle-stroke-opacity": 0.9,
      },
    },
    {
      id: `${LAYER_PREFIX}timeline-running`,
      type: "circle",
      source: TIMELINE_SOURCE,
      filter: ["==", ["get", "phase"], "running"],
      layout: {
        visibility: visible(state.year !== null && state.layers.has("plants")),
        "circle-sort-key": ["-", ["coalesce", ["get", "capacityMw"], 0]],
      },
      paint: {
        "circle-radius": plantRadius,
        "circle-color": technologyColor(palette),
        "circle-opacity": 0.92,
        "circle-stroke-color": palette.casing,
        "circle-stroke-width": 1,
      },
    },
    // Data centres are loads, not generation, so they stay out of the technology palette entirely: one
    // dark slate colour, a ring for the ones not yet running, and a legend entry that names them.
    // (A distinct shape would mean sprites or SDF icons; that machinery is not worth it for one layer.)
    // A halo under the running ones (2026-11-16): there are few of them and their dots are small, so
    // with the layer switched on they were close to invisible among the lines. Same colour, blurred, so the
    // legend's dot still names what glows.
    {
      id: `${LAYER_PREFIX}datacenters-glow`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "datacenters",
      filter: dataCenterFilter(state, true),
      layout: { visibility: show("datacenters") },
      paint: {
        "circle-radius": byZoom(DATACENTER_RADIUS_STOPS, 2.4, 7),
        "circle-color": palette.datacenter,
        "circle-blur": 1,
        "circle-opacity": palette.datacenterGlow,
      },
    },
    {
      id: `${LAYER_PREFIX}datacenters-planned`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "datacenters",
      filter: dataCenterFilter(state, false),
      layout: { visibility: show("datacenters") },
      paint: {
        "circle-radius": datacenterRadius,
        "circle-color": palette.datacenter,
        ...hollow(palette.datacenter),
      },
    },
    {
      id: `${LAYER_PREFIX}datacenters`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "datacenters",
      filter: dataCenterFilter(state, true),
      layout: { visibility: show("datacenters") },
      paint: { "circle-radius": datacenterRadius, "circle-color": palette.datacenter, ...solid },
    },
    {
      id: `${LAYER_PREFIX}datacenters-selected`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "datacenters",
      filter: selectionFilter(state.selected),
      paint: {
        "circle-radius": byZoom(DATACENTER_RADIUS_STOPS, 1, 5),
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.selection,
        "circle-stroke-width": 3,
      },
    },
    {
      id: `${LAYER_PREFIX}points-selected`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "plants",
      filter: selectionFilter(state.selected),
      paint: {
        "circle-radius": byZoom(PLANT_RADIUS_STOPS, 1, 5),
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.selection,
        "circle-stroke-width": 3,
      },
    },
    {
      id: `${LAYER_PREFIX}substations-selected`,
      type: "circle",
      source: GRID_SOURCE,
      "source-layer": "substations",
      filter: selectionFilter(state.selected),
      paint: {
        "circle-radius": byZoom(SUBSTATION_RADIUS_STOPS, 1, 5),
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.selection,
        "circle-stroke-width": 3,
      },
    },
  );

  // Gas production per country: a disc whose area follows the latest gas day, at the country's anchor.
  // There is one figure per country, so the disc is the whole layer; the days are in the details.
  layers.push({
    id: `${LAYER_PREFIX}gas`,
    type: "circle",
    source: GAS_SOURCE,
    layout: { visibility: show("gas") },
    paint: {
      "circle-radius": GAS_RADIUS,
      "circle-color": palette.gas,
      "circle-opacity": 0.55,
      "circle-stroke-color": palette.gas,
      "circle-stroke-width": hovered(3, 1.5),
      "circle-stroke-opacity": 0.95,
    },
  });
  layers.push(
    selectedRing("gas", GAS_SOURCE, undefined, ["+", GAS_RADIUS, 4], palette, state.selected, show("gas")),
  );

  // HEP ODS free capacity (Faza 25): a point per substation, stronger the more a new plant can connect;
  // 110/x kV larger than 35/x kV; the best categories drawn on top where points overlap.
  const cap = palette.capacity;
  const byLevel = (hv: number, mv: number): ExpressionSpecification => [
    "match",
    ["get", "level"],
    "hv",
    hv,
    mv,
  ];
  layers.push({
    id: CAPACITY_LAYER,
    type: "circle",
    source: CAPACITY_SOURCE,
    layout: { visibility: show("capacity"), "circle-sort-key": ["get", "rank"] },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, byLevel(5, 3.5), 11, byLevel(9, 6)],
      "circle-color": [
        "match",
        ["get", "existing"],
        "A",
        cap.A,
        "B",
        cap.B,
        "C",
        cap.C,
        "D",
        cap.D,
        cap.none,
      ],
      "circle-stroke-color": ["match", ["get", "existing"], "none", cap.noneRing, cap.ring],
      "circle-stroke-width": 1,
      // a substation with no room says so as clearly as one with room; it is drawn underneath (rank)
      "circle-opacity": ["match", ["get", "existing"], "none", 0.8, 0.95],
    },
  });

  // Gas storage (GIE AGSI): a ringed disc where the operator's platform places the facility, with the
  // gas layer. How full it is stands next to it as a number, never as a size: sizes here mean flows.
  layers.push({
    id: GAS_STORAGE_LAYER,
    type: "circle",
    source: GAS_STORAGE_SOURCE,
    layout: { visibility: show("gas") },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 10, 9],
      "circle-color": palette.casing,
      "circle-stroke-color": palette.gas,
      "circle-stroke-width": 3,
    },
  });
  if (labels) {
    layers.push({
      id: `${LAYER_PREFIX}gas-storage-labels`,
      type: "symbol",
      source: GAS_STORAGE_SOURCE,
      layout: {
        visibility: show("gas"),
        "text-field": ["concat", ["get", "name"], "\n", ["to-string", ["get", "full"]], " %"],
        "text-font": labels,
        "text-size": 11.5,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-max-width": 12,
      },
      paint: {
        "text-color": palette.labelText,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.4,
      },
    });
  }

  // The points of the gas system that are one place (the LNG terminal, the border points): a circle whose
  // area follows what flowed through the point on the gas day the bar shows, on the country disc's scale.
  layers.push({
    id: GAS_FLOW_LAYER,
    type: "circle",
    source: GAS_FLOW_SOURCE,
    layout: { visibility: show("gas") },
    paint: {
      "circle-radius": GAS_FLOW_RADIUS,
      "circle-color": palette.gas,
      "circle-opacity": 0.3,
      "circle-stroke-color": palette.gas,
      "circle-stroke-width": 2,
    },
  });
  if (labels) {
    layers.push({
      id: `${LAYER_PREFIX}gas-flow-labels`,
      type: "symbol",
      source: GAS_FLOW_SOURCE,
      layout: {
        visibility: show("gas"),
        "text-field": ["get", "text"],
        "text-font": labels,
        "text-size": 11.5,
        "text-variable-anchor": ["top", "bottom", "left", "right"],
        "text-radial-offset": 1,
        "text-max-width": 12,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": palette.labelText,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.4,
      },
    });
  }

  // Geothermal sites: solid for what runs, lighter for what is coming; size grows with electric capacity.
  layers.push({
    id: GEOTHERMAL_SITES_LAYER,
    type: "circle",
    source: GEOTHERMAL_SOURCE,
    filter: ["==", ["geometry-type"], "Point"],
    layout: { visibility: show("geothermal") },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "mw"], 0, 5, 20, 7, 100, 11],
      "circle-color": [
        "match",
        ["get", "status"],
        "operating",
        palette.geoPhase.operating,
        "project",
        palette.geoPhase.project,
        "potential_confirmed",
        palette.geoPhase.potential_confirmed,
        "exploration",
        palette.geoPhase.exploration,
        palette.geoPhase.local_project,
      ],
      "circle-stroke-color": palette.casing,
      "circle-stroke-width": 1.5,
    },
  });

  // Live flows on top of the grid: arcs scaled by MW, arrowheads as small triangles (no glyphs needed).
  const liveVisibility = visible(state.live);
  const halo = palette.flowHalo;
  layers.push(
    {
      // dark theme: a glow in the flow colour; light theme: a soft shadow below the arc (Faza 18)
      id: FLOW_HALO_LAYER,
      type: "line",
      source: LIVE_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { visibility: liveVisibility, "line-cap": "round" },
      paint: {
        "line-color": halo.color,
        "line-opacity": halo.opacity,
        "line-width": arcWidth(halo.extra),
        "line-blur": halo.blur,
        "line-translate": [0, halo.offsetY],
      },
    },
    {
      // light theme: a pale edge that parts the arc from the lines and points beneath it
      id: FLOW_CASING_LAYER,
      type: "line",
      source: LIVE_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { visibility: visible(state.live && halo.casing > 0), "line-cap": "round" },
      paint: { "line-color": palette.casing, "line-width": arcWidth(halo.casing) },
    },
    {
      id: `${LAYER_PREFIX}live-arcs`,
      type: "line",
      source: LIVE_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { visibility: liveVisibility, "line-cap": "round" },
      paint: {
        "line-color": palette.flow,
        "line-opacity": 0.85,
        "line-width": arcWidth(0),
      },
    },
    {
      // pale dashes travelling along the arc in the direction of the flow (flowAnimation.ts)
      id: FLOW_DASH_LAYER,
      type: "line",
      source: LIVE_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      // butt caps: a zero-length dash in the pattern must not render as a dot
      layout: { visibility: liveVisibility, "line-cap": "butt" },
      paint: {
        "line-color": palette.casing,
        "line-opacity": 0.75,
        "line-width": ["interpolate", ["linear"], ["get", "mw"], 0, 0.6, 500, 1.6, 1500, 3.5],
        "line-dasharray": [...stepPattern(0)],
      },
    },
    {
      id: `${LAYER_PREFIX}live-heads`,
      type: "fill",
      source: LIVE_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: { visibility: liveVisibility },
      paint: { "fill-color": palette.flow, "fill-opacity": 0.95 },
    },
  );

  if (labels) {
    // the day's figure on each gas disc, in GWh with one decimal, formatted the way the interface is
    layers.push({
      id: `${LAYER_PREFIX}gas-labels`,
      type: "symbol",
      source: GAS_SOURCE,
      layout: {
        visibility: show("gas"),
        "text-field": [
          "concat",
          [
            "number-format",
            ["/", ["get", "latestKwh"], 1_000_000],
            { locale: state.lang, "min-fraction-digits": 1, "max-fraction-digits": 1 },
          ],
          " GWh",
        ],
        "text-font": labels,
        "text-size": 12,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": palette.labelText,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.6,
      },
    });
    const plantLabel = {
      type: "symbol" as const,
      source: GRID_SOURCE,
      "source-layer": "plants",
      minzoom: 7,
      paint: {
        "text-color": palette.labelText,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.4,
      },
    };
    const plantLabelSize: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 7, 10.5, 12, 12.5];
    layers.push({
      ...plantLabel,
      id: `${LAYER_PREFIX}plant-labels`,
      filter: ["all", ["has", "name"], ["!", ["has", "expansionOf"]], plantFilter(state, true)],
      layout: {
        visibility: show("plants"),
        "text-field": ["get", "name"],
        "text-font": labels,
        "text-size": plantLabelSize,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-optional": true,
        "symbol-sort-key": ["-", ["coalesce", ["get", "capacityMw"], 0]],
      },
    });
    // A new part of a running plant carries the plant's own name in the source and sits on its very spot.
    // Its label says which it is and goes under the plant's own. A layer of its own, for two reasons found
    // on the live map (2026-11-17): the labels above are for plants in operation only, which an expansion
    // never is; and placed with the others it would collide with the label of the plant it sits on.
    layers.push({
      ...plantLabel,
      id: `${LAYER_PREFIX}plant-expansion-labels`,
      filter: ["all", ["has", "name"], ["has", "expansionOf"], plantFilter(state, false)],
      layout: {
        visibility: show("plants"),
        "text-field": [
          "concat",
          ["get", "name"],
          " (",
          ["match", ["get", "status"], "construction", words.expansion_construction, words.expansion_planned],
          ")",
        ],
        "text-font": labels,
        "text-size": plantLabelSize,
        "text-offset": [0, 4],
        "text-anchor": "top",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
    });
  }
  // The grid next to the selected plant: the lines that end at its nearest substation, and that
  // substation. Drawn from the tiles whether or not the lines and substations layers are switched on: the
  // reader asked about this plant, not for another layer.
  if (around) {
    const isLine: ExpressionSpecification = ["in", ["get", "id"], ["literal", around.lines]];
    layers.push(
      {
        id: `${LAYER_PREFIX}around-lines-glow`,
        type: "line",
        source: GRID_SOURCE,
        "source-layer": "lines",
        filter: isLine,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": palette.traveller, "line-width": 8, "line-blur": 6, "line-opacity": 0.5 },
      },
      {
        id: `${LAYER_PREFIX}around-lines`,
        type: "line",
        source: GRID_SOURCE,
        "source-layer": "lines",
        filter: isLine,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": palette.traveller, "line-width": 2 },
      },
      {
        id: `${LAYER_PREFIX}around-substation`,
        type: "circle",
        source: GRID_SOURCE,
        "source-layer": "substations",
        filter: ["==", ["get", "id"], around.substation],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 10],
          "circle-color": palette.traveller,
          "circle-opacity": 0.25,
          "circle-stroke-color": palette.traveller,
          "circle-stroke-width": 2,
        },
      },
    );
  }

  // A guided story's point of light and the trail behind it (stories/travel.ts), above everything else.
  // The source is empty unless a story is showing its traveller, so these layers normally draw nothing.
  layers.push(
    {
      id: `${LAYER_PREFIX}travel-trail-glow`,
      type: "line",
      source: TRAVEL_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": palette.traveller, "line-width": 9, "line-blur": 7, "line-opacity": 0.55 },
    },
    {
      id: `${LAYER_PREFIX}travel-trail`,
      type: "line",
      source: TRAVEL_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": palette.traveller, "line-width": 2.4 },
    },
    {
      id: `${LAYER_PREFIX}travel-head-glow`,
      type: "circle",
      source: TRAVEL_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 18,
        "circle-color": palette.traveller,
        "circle-blur": 1,
        "circle-opacity": 0.7,
      },
    },
    {
      id: `${LAYER_PREFIX}travel-head`,
      type: "circle",
      source: TRAVEL_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5.5,
        "circle-color": "#ffffff",
        "circle-stroke-color": palette.traveller,
        "circle-stroke-width": 2.5,
      },
    },
  );
  return layers;
}
