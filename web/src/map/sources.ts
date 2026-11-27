/**
 * The map's own sources (Faza 26 split from layers.ts): their ids, the layer ids other modules refer to, the
 * opt-in archives and the sources themselves for a build's tiles and the overlays the app has loaded.
 */
import type { FeatureCollection } from "geojson";

import type { SolarImage } from "../data/solar";
import type { SourceSpecification } from "maplibre-gl";

import type { LayerKey } from "../domain";

export const GRID_SOURCE = "energymap-grid";
export const BOUNDARY_SOURCE = "energymap-boundaries";
export const DISTRIBUTION_SOURCE = "energymap-distribution";
export const CHARGER_SOURCE = "energymap-chargers";
/** charging stations added up by cell (pipeline products.charger_grid), for zooms below the archive's */
export const CHARGER_OVERVIEW_SOURCE = "energymap-chargers-overview";
export const EXTRACTION_SOURCE = "energymap-extraction";
export const LAYER_PREFIX = "energymap-";
export const LIVE_SOURCE = "energymap-live";
/** daily gas production per country (data/gas.ts); a GeoJSON source like the live layer */
export const GAS_SOURCE = "energymap-gas";
/** geothermal potential cells and sites (data/geothermal.ts), loaded while the layer is on */
export const GEOTHERMAL_SOURCE = "energymap-geothermal";
export const GEOTHERMAL_SITES_LAYER = `${LAYER_PREFIX}geothermal-sites`;
/** HEP ODS substations by acceptance category (data/hep.ts), loaded while the layer is on (Faza 25) */
export const CAPACITY_SOURCE = "energymap-capacity";
/** the point of light of a guided story and its trail (stories/travel.ts); filled by MapApi.showTraveller */
export const TRAVEL_SOURCE = "energymap-travel";
/** the solar potential picture (data/solar.ts); declared only while the layer is on and published */
export const SOLAR_SOURCE = "energymap-solar";
export const CAPACITY_LAYER = `${LAYER_PREFIX}capacity`;
/** gas storage facilities (data/gasStorage.ts), shown with the gas layer; a click opens them in its bar */
export const GAS_STORAGE_SOURCE = "energymap-gas-storage";
export const GAS_STORAGE_LAYER = `${LAYER_PREFIX}gas-storage`;
/** the points of the gas system that are one place (data/gasFlows.ts), sized by the day's flow */
export const GAS_FLOW_SOURCE = "energymap-gas-flow";
export const GAS_FLOW_LAYER = `${LAYER_PREFIX}gas-flow`;
/** the net gas flow across each border crossing (data/gasFlows.ts `borderOverlay`), shown with the gas layer */
export const GAS_BORDER_SOURCE = "energymap-gas-border";
/** charging stations added up by area, drawn below the zoom where single stations are in the tiles */
export const CHARGER_OVERVIEW_LAYER = `${LAYER_PREFIX}chargers-overview`;
/** retired plants for the time machine (data/timeline.ts); a GeoJSON source like the live layer */
export const TIMELINE_SOURCE = "energymap-timeline";
/** The soft halo under transmission lines in the dark theme. */
export const LINE_GLOW_LAYER = `${LAYER_PREFIX}lines-glow`;
/** Countries filled by the day-ahead price at the live layer's hour. */
export const PRICE_FILL_LAYER = `${LAYER_PREFIX}live-price-fill`;
/** Under the live arcs: glow (dark theme) or shadow (light theme), and the light theme's pale casing. */
export const FLOW_HALO_LAYER = `${LAYER_PREFIX}live-halo`;
export const FLOW_CASING_LAYER = `${LAYER_PREFIX}live-casing`;

/** The travelling dashes on live arcs; MapView rewrites its dash pattern every frame. */
export const FLOW_DASH_LAYER = `${LAYER_PREFIX}live-dashes`;

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Tile property promoted to the feature id, so hover can be expressed as feature state: one
 * `setFeatureState` call per hovered object instead of a new style for every mouse move.
 */
export const FEATURE_ID = "id";

/** Layers that respond to clicks, mapped to the tile layer whose properties they carry. */
export const INTERACTIVE_LAYERS: Record<string, string> = {
  [`${LAYER_PREFIX}lines`]: "lines",
  [`${LAYER_PREFIX}lines-planned`]: "lines",
  [`${LAYER_PREFIX}substations`]: "substations",
  [`${LAYER_PREFIX}substations-planned`]: "substations",
  [`${LAYER_PREFIX}plants`]: "plants",
  [`${LAYER_PREFIX}plants-planned`]: "plants",
  [`${LAYER_PREFIX}pipelines`]: "pipelines",
  [`${LAYER_PREFIX}pipelines-planned`]: "pipelines",
  [`${LAYER_PREFIX}datacenters`]: "datacenters",
  [`${LAYER_PREFIX}datacenters-planned`]: "datacenters",
  [`${LAYER_PREFIX}chargers`]: "chargers",
  [`${LAYER_PREFIX}extraction`]: "extraction",
  [`${LAYER_PREFIX}gas`]: "gas",
  [`${LAYER_PREFIX}cities`]: "cities",
  [`${LAYER_PREFIX}distribution-lines`]: "distribution_lines",
  [`${LAYER_PREFIX}distribution-substations`]: "distribution_substations",
};

/**
 * Where a selected id can be looked up when a shared link arrives before anything has been clicked.
 * Sources that the current build or the current layer choice does not provide are skipped.
 */
export const SELECTABLE: readonly { source: string; sourceLayer: string }[] = [
  { source: GRID_SOURCE, sourceLayer: "plants" },
  { source: GRID_SOURCE, sourceLayer: "substations" },
  { source: GRID_SOURCE, sourceLayer: "lines" },
  { source: GRID_SOURCE, sourceLayer: "pipelines" },
  { source: GRID_SOURCE, sourceLayer: "datacenters" },
  { source: GRID_SOURCE, sourceLayer: "cities" },
  { source: CHARGER_SOURCE, sourceLayer: "chargers" },
  { source: EXTRACTION_SOURCE, sourceLayer: "extraction" },
  // a GeoJSON source has no source layer; MapLibre ignores the name and fromProperties keys on it
  { source: GAS_SOURCE, sourceLayer: "gas" },
  { source: DISTRIBUTION_SOURCE, sourceLayer: "distribution_lines" },
  { source: DISTRIBUTION_SOURCE, sourceLayer: "distribution_substations" },
];

export interface OptionalArchive {
  url: string;
  minZoom: number;
  maxZoom: number;
}

/** Archives a build publishes only when it has features for them, each behind its own switch. */
export const OPT_IN_ARCHIVES = ["distribution", "chargers", "extraction"] as const;
export type OptInArchive = (typeof OPT_IN_ARCHIVES)[number];
/** Which opt-in archives are drawn: the switch is on AND the build publishes the archive. */
export type OptIn = Record<OptInArchive, boolean>;
export const NOTHING_OPTED_IN: OptIn = { distribution: false, chargers: false, extraction: false };

const OPT_IN_SOURCE: Record<OptInArchive, string> = {
  distribution: DISTRIBUTION_SOURCE,
  chargers: CHARGER_SOURCE,
  extraction: EXTRACTION_SOURCE,
};

export interface TileUrls extends Partial<Record<OptInArchive, OptionalArchive>> {
  /** GeoJSON of charging stations added up by cell; builds before 2026-11-16 have none */
  chargerOverview?: string;
  grid: string;
  boundaries: string;
  gridMaxZoom: number;
  boundariesMaxZoom: number;
}

/** The opt-in archives to draw for `state`: on when switched on and published by this build. */
export function optedIn(urls: TileUrls, layers: ReadonlySet<LayerKey>): OptIn {
  return {
    distribution: urls.distribution !== undefined && layers.has("distribution"),
    chargers: urls.chargers !== undefined && layers.has("chargers"),
    extraction: urls.extraction !== undefined && layers.has("extraction"),
  };
}

/** GeoJSON overlays loaded by the app while their layer is on; each source exists either way (empty). */
export interface Overlays {
  live?: FeatureCollection | null;
  gas?: FeatureCollection | null;
  timeline?: FeatureCollection | null;
  geothermal?: FeatureCollection | null;
  capacity?: FeatureCollection | null;
  gasStorage?: FeatureCollection | null;
  gasFlow?: FeatureCollection | null;
  gasBorder?: FeatureCollection | null;
  /** the solar potential picture and its corners, while that layer is on */
  solar?: SolarImage | null;
}

export function dataSources(
  urls: TileUrls,
  {
    live = null,
    gas = null,
    timeline = null,
    geothermal = null,
    capacity = null,
    gasStorage = null,
    gasFlow = null,
    gasBorder = null,
    solar = null,
  }: Overlays = {},
  optIn: OptIn = NOTHING_OPTED_IN,
): Record<string, SourceSpecification> {
  // Only while the layer is on. MapLibre reads an archive's header as soon as its source exists, so
  // leaving it declared would cost every visitor a request (e2e/distribution.spec.ts).
  const optional: Record<string, SourceSpecification> = {};
  for (const key of OPT_IN_ARCHIVES) {
    const archive = urls[key];
    if (!optIn[key] || archive === undefined) continue;
    optional[OPT_IN_SOURCE[key]] = {
      type: "vector",
      url: `pmtiles://${archive.url}`,
      minzoom: archive.minZoom,
      maxzoom: archive.maxZoom,
      promoteId: FEATURE_ID,
    };
  }
  // MapLibre fetches the address itself, and only while the layer is on. The file is made by our own
  // build, in the shape MapLibre reads (GeoJSON), so nothing has to pass through the app.
  if (optIn.chargers && urls.chargerOverview !== undefined) {
    optional[CHARGER_OVERVIEW_SOURCE] = { type: "geojson", data: urls.chargerOverview };
  }
  if (solar) {
    const [west, south, east, north] = solar.bounds;
    // the picture's rows are spaced as the map's projection spaces latitude (pipeline solar/potential.py),
    // so stretching it between its four corners puts every cell where it belongs
    optional[SOLAR_SOURCE] = {
      type: "image",
      url: solar.url,
      coordinates: [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
    };
  }
  return {
    // always present, so switching the live layer on or off is a plain data/visibility diff
    [LIVE_SOURCE]: { type: "geojson", data: live ?? EMPTY },
    [GAS_SOURCE]: { type: "geojson", data: gas ?? EMPTY, promoteId: FEATURE_ID },
    [TIMELINE_SOURCE]: { type: "geojson", data: timeline ?? EMPTY },
    [GEOTHERMAL_SOURCE]: { type: "geojson", data: geothermal ?? EMPTY },
    [CAPACITY_SOURCE]: { type: "geojson", data: capacity ?? EMPTY },
    [GAS_STORAGE_SOURCE]: { type: "geojson", data: gasStorage ?? EMPTY },
    [GAS_FLOW_SOURCE]: { type: "geojson", data: gasFlow ?? EMPTY },
    [GAS_BORDER_SOURCE]: { type: "geojson", data: gasBorder ?? EMPTY },
    // always declared and empty; the map fills it directly while a story's light travels, because a new
    // style sixty times a second would be the wrong tool for moving one point
    [TRAVEL_SOURCE]: { type: "geojson", data: EMPTY },
    [GRID_SOURCE]: {
      type: "vector",
      url: `pmtiles://${urls.grid}`,
      maxzoom: urls.gridMaxZoom,
      promoteId: FEATURE_ID,
    },
    [BOUNDARY_SOURCE]: {
      type: "vector",
      url: `pmtiles://${urls.boundaries}`,
      maxzoom: urls.boundariesMaxZoom,
    },
    ...optional,
  };
}
