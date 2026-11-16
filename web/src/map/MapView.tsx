import "maplibre-gl/dist/maplibre-gl.css";

import {
  addProtocol,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  GeoJSONSource,
  ScaleControl,
  setWorkerUrl,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type Point,
  type PointLike,
  type StyleSpecification,
} from "maplibre-gl";
// Vite bundles MapLibre's worker (with its shared chunk) and gives us its URL; MapLibre would otherwise look
// for the worker next to its own module file, which does not exist after bundling.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { FeatureCollection } from "geojson";

import type { LiveOverlay } from "../data/live";
import { SCOPE_COUNTRIES, type CountryCode } from "../domain";
import { useI18n } from "../i18n";
import { DEFAULT_VIEW, type AppState } from "../state/url";
import { composeStyle, loadBasemap, type Basemap } from "./basemap";
import {
  dataLayers,
  dataSources,
  FLOW_DASH_LAYER,
  CAPACITY_LAYER,
  GEOTHERMAL_SITES_LAYER,
  GRID_SOURCE,
  INTERACTIVE_LAYERS,
  LAYER_PREFIX,
  LINE_GLOW_LAYER,
  optedIn,
  SELECTABLE,
  SELECTED_RING_STROKE,
  SELECTED_RING_SUFFIX,
  type TileUrls,
} from "./layers";
import { TRAVEL_SOURCE } from "./sources";
import type { Traveller } from "../stories/travel";
import type { Around } from "../data/nearby";
import type { SolarImage } from "../data/solar";
import type { StyleState } from "./filters";
import { firstViewBounds } from "./firstView";
import { BREATH_EVERY_MS, BREATH_FADE_MS, BREATH_STEP_MS, breathes, breathPeak } from "./glowBreath";
import type { Spotlight } from "./spotlight";
import { inView, sameInView, NOTHING_IN_VIEW, type InView } from "./inView";
import { flightPlan, INTRO_STAGE_AT, SETTLE_DELAY_MS, type Camera, type Flight } from "./introFlight";
import { INTRO_SETTLE, introLayers, introStyle, type IntroStage } from "./introStyle";
import { pulseWidth, SELECTION_PULSE_MS } from "./selectionPulse";
import { PALETTES, type Theme } from "./palette";
import { fromProperties, toSelection, type Selection } from "./selection";
import { canvasToBlob, composeSnapshot } from "./snapshot";
import { FLOW_CYCLE_MS, FLOW_STEPS, stepAt, stepPattern } from "./flowAnimation";
import { timelineTooltip, tooltipFor } from "./tooltip";
import styles from "./MapView.module.css";

/** Follows the visitor's "reduce motion" preference, live. */
function useReducedMotion(): boolean {
  const query = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)"), []);
  const [reduced, setReduced] = useState(query.matches);
  useEffect(() => {
    const onChange = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [query]);
  return reduced;
}

/** The time machine's layers of plants drawn from the timeline (layers.ts). */
const TIMELINE_LAYERS = [`${LAYER_PREFIX}timeline-running`, `${LAYER_PREFIX}timeline-closed`];

/** The map's own limits; the intro lifts them while it flies in from the globe and puts them back. */
const MIN_ZOOM = 3;
const INTRO_MIN_ZOOM = 1.5;
const regionMaxBounds = (bounds: [number, number, number, number]): LngLatBoundsLike => [
  [bounds[0] - 12, bounds[1] - 8],
  [bounds[2] + 12, bounds[3] + 8],
];

let initialized = false;
function initMapLibre(): void {
  if (initialized) return;
  setWorkerUrl(workerUrl);
  addProtocol("pmtiles", new Protocol().tile);
  initialized = true;
}

/** How a guided story looks at the map: tilted (degrees from straight down) and turned (degrees from north). */
export interface Tilt {
  pitch: number;
  bearing: number;
}

export interface MapApi {
  flyTo: (lng: number, lat: number, zoom: number) => void;
  /**
   * The same, for a move the reader did not ask for by name (a step of a guided story): unhurried, and
   * a plain jump for readers who asked their system for less motion.
   */
  travelTo: (lng: number, lat: number, zoom: number, tilt?: Tilt) => void;
  /** Back to a flat map facing north, if a story left it tilted or turned; otherwise nothing. */
  level: () => void;
  /** A guided story's point of light and the trail behind it; null takes both off the map. */
  showTraveller: (traveller: Traveller | null) => void;
  /** A PNG of the current view with the credits written into the picture. */
  snapshot: () => Promise<Blob>;
}

/** Credit for the basemap under our data, as its terms ask for it. */
const BASEMAP_CREDIT: Record<Basemap["kind"], string> = {
  maptiler: "© MapTiler © OpenStreetMap contributors",
  fallback: "",
};

interface Props {
  tiles: TileUrls;
  regionBounds: [number, number, number, number];
  maptilerKey: string | null;
  /** Localised attribution for the data this build is made of. */
  attribution: string;
  /** live flows and prices for the selected hour, or null when the layer is off */
  live: LiveOverlay | null;
  /** gas production per country, or null when the layer is off */
  gas: FeatureCollection | null;
  /** retired plants for the time machine's year, or null when it is off */
  timeline: FeatureCollection | null;
  /** geothermal potential and sites (Faza 21), or null while the layer is off */
  geothermal?: FeatureCollection | null;
  /** a geothermal site was clicked on the map */
  onGeothermalSite?: (id: string) => void;
  /** HEP ODS substations by acceptance category (Faza 25), or null while the layer is off */
  capacity?: FeatureCollection | null;
  /** a HEP ODS substation was clicked on the map */
  onCapacityStation?: (id: string) => void;
  theme: Theme;
  state: AppState;
  /** one technology or voltage lit from the legend or the overview (spotlight.ts) */
  spotlight?: Spotlight;
  /** the solar potential picture, while that layer is on and published (data/solar.ts) */
  solar?: SolarImage | null;
  /** a click on the map that hit nothing: where it was (the solar layer reads a value there) */
  onPoint?: (point: { lng: number; lat: number }) => void;
  /** the grid next to the selected plant, lit on the map (data/nearby.ts) */
  around?: Around | null;
  onViewChange: (view: { lng: number; lat: number; zoom: number }) => void;
  onSelect: (selection: Selection | null) => void;
  onBasemap: (kind: Basemap["kind"]) => void;
  onReady: (api: MapApi) => void;
  /** what kinds of things are on screen, after every settle; the legend plays down the rest */
  onInView: (view: InView) => void;
  /**
   * The first-visit intro (Faza 22): `hold` waits on the globe with the grid dark, `play` flies down to the
   * usual first view and lights the grid up, null is the ordinary map. Only a first visit without state in
   * the link has one, so it is set from the start or never; once null it stays null.
   */
  intro?: "hold" | "play" | null;
  /** the intro's first frame is drawn: it may play */
  onIntroReady?: () => void;
  /** the camera has arrived and the map is settling: the overlay may hand over */
  onIntroDone?: () => void;
}

const HIT_TOLERANCE_PX = 6;
/** Below this map width the credits start collapsed (MapLibre's own compact threshold). */
const COMPACT_ATTRIBUTION_MAX_WIDTH = 640;
/** Gap between the pointer and the tooltip, so the cursor never covers the first letters. */
const TOOLTIP_OFFSET_PX = 14;

/** The feature under the pointer, addressed the way feature state needs it. */
interface Hovered {
  source: string;
  sourceLayer: string;
  id: string;
}

export function MapView(props: Props) {
  const { tiles, regionBounds, maptilerKey, attribution, theme, state, live, gas, timeline } = props;
  const spotlight = props.spotlight ?? null;
  const around = props.around ?? null;
  const geothermal = props.geothermal ?? null;
  const capacity = props.capacity ?? null;
  const solar = props.solar ?? null;
  const { onViewChange, onSelect, onBasemap, onReady, onInView, onGeothermalSite, onCapacityStation } = props;
  const { onPoint } = props;
  const intro = props.intro ?? null;
  const { onIntroReady, onIntroDone } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // "ready" means the most recently applied style has finished rendering, so tests and users never act
  // on a map that is still showing the previous filters.
  const appliedStyle = useRef<StyleSpecification | null>(null);
  const [idleStyle, setIdleStyle] = useState<StyleSpecification | null>(null);
  // Same fact for the animation loop, which must not repaint before the new style has settled: a map
  // that is repainted every frame never becomes idle, and "ready" would never arrive.
  const settledRef = useRef(false);
  const [basemap, setBasemap] = useState<{ theme: Theme; value: Basemap } | null>(null);
  const palette = PALETTES[theme];

  // Map handlers are registered once; they read the latest callbacks and selection through refs,
  // which are synchronised after every render (never during it).
  const callbacks = useRef({
    onViewChange,
    onSelect,
    onInView,
    onGeothermalSite,
    onCapacityStation,
    onPoint,
    onIntroReady,
    onIntroDone,
  });
  const inViewRef = useRef<InView>(NOTHING_IN_VIEW);
  const selectedRef = useRef(state.selected);
  const i18nRef = useRef(i18n);
  const creditsRef = useRef({ attribution, basemap: basemap?.value.kind ?? null });
  useLayoutEffect(() => {
    callbacks.current = {
      onViewChange,
      onSelect,
      onInView,
      onGeothermalSite,
      onCapacityStation,
      onPoint,
      onIntroReady,
      onIntroDone,
    };
    selectedRef.current = state.selected;
    i18nRef.current = i18n;
    creditsRef.current = { attribution, basemap: basemap?.value.kind ?? null };
  });
  // Hover is handled outside React on purpose: it changes at pointer speed, and a re-render or a new
  // style per mouse move would make the map stutter. Feature state highlights, a plain element shows.
  const hoveredRef = useRef<Hovered | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Id whose details were already delivered, so idle events do not resolve it again.
  const resolvedRef = useRef<string | null>(null);
  // The intro (Faza 22): while it runs the camera is not the reader's, so it is not written to the link,
  // and the map's limits are lifted. `flight` is set once the map exists; the stage advances on timers.
  const introActiveRef = useRef(intro !== null);
  const introReadyRef = useRef(false);
  // where the intro lands, known as soon as the map exists (the plan reaches the style once it has loaded)
  const introFinalRef = useRef<Camera | null>(null);
  const [flight, setFlight] = useState<{ plan: Flight } | null>(null);
  const [introStage, setIntroStage] = useState<IntroStage>(0);
  const stage: IntroStage | null = intro === null ? null : introStage;

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    initMapLibre();
    const initial = state.view;
    const map = new MapLibreMap({
      container: container.current,
      style: { version: 8, sources: {}, layers: [] },
      ...(initial
        ? { center: [initial.lng, initial.lat], zoom: initial.zoom }
        : { center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat], zoom: DEFAULT_VIEW.zoom }),
      minZoom: MIN_ZOOM,
      maxZoom: 17,
      maxBounds: regionMaxBounds(regionBounds),
      attributionControl: { compact: true, customAttribution: attribution },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
    // On a phone the credits run to four lines and eat a map that is already short. MapLibre opens its
    // compact attribution and collapses it on the first drag; here it starts collapsed behind the (i)
    // button when the map is narrow, which is what the licences allow and what phone users expect.
    map.once("load", () => {
      if (map.getContainer().clientWidth > COMPACT_ATTRIBUTION_MAX_WIDTH) return;
      const attribution = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
      const toggle = attribution?.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-button");
      toggle?.click();
    });
    // The attribution line grows with every data source and wraps on narrow windows, so its height is
    // measured and published as a CSS variable. Everything that sits along the bottom edge keeps clear
    // of it by that number instead of a guess (e2e/layout.spec.ts checks the result).
    const corner = container.current.querySelector(".maplibregl-ctrl-bottom-right");
    const shell = container.current.parentElement;
    let chrome: ResizeObserver | null = null;
    if (corner instanceof HTMLElement && shell) {
      chrome = new ResizeObserver(([entry]) => {
        const height = entry?.contentRect.height ?? corner.offsetHeight;
        shell.style.setProperty("--map-chrome", `${Math.ceil(height)}px`);
      });
      chrome.observe(corner);
    }
    if (!initial) {
      const { clientWidth, clientHeight } = container.current;
      map.fitBounds(firstViewBounds(regionBounds, clientWidth, clientHeight), {
        padding: 24,
        animate: false,
      });
    }
    if (introActiveRef.current) {
      // the view the map would open on is where the intro lands; it starts out on the globe
      const [lng, lat] = map.getCenter().toArray();
      const final: Camera = { center: [lng, lat], zoom: map.getZoom(), pitch: 0, bearing: 0 };
      const plan = flightPlan(final, container.current.clientWidth);
      introFinalRef.current = final;
      map.setMinZoom(INTRO_MIN_ZOOM);
      map.setMaxBounds(null);
      map.jumpTo(plan.start);
      map.once("load", () => {
        setFlight({ plan });
      });
    }

    const interactive = Object.keys(INTERACTIVE_LAYERS);
    const hit = (point: Point): MapGeoJSONFeature | undefined => {
      const present = interactive.filter((id) => map.getLayer(id));
      if (present.length === 0) return undefined;
      const box: [PointLike, PointLike] = [
        [point.x - HIT_TOLERANCE_PX, point.y - HIT_TOLERANCE_PX],
        [point.x + HIT_TOLERANCE_PX, point.y + HIT_TOLERANCE_PX],
      ];
      return map.queryRenderedFeatures(box, { layers: present })[0];
    };

    // geothermal sites and HEP ODS substations open their card instead of the asset details (they are not
    // in the tiles); the first layer listed that has something under the pointer wins
    const overlayHit = (point: Point): { layer: string; id: string } | null => {
      for (const layer of [CAPACITY_LAYER, GEOTHERMAL_SITES_LAYER]) {
        if (!map.getLayer(layer)) continue;
        const id: unknown = map.queryRenderedFeatures(point, { layers: [layer] })[0]?.properties.id;
        if (typeof id === "string") return { layer, id };
      }
      return null;
    };
    map.on("click", (event) => {
      const overlay = overlayHit(event.point);
      const open =
        overlay?.layer === CAPACITY_LAYER
          ? callbacks.current.onCapacityStation
          : callbacks.current.onGeothermalSite;
      if (overlay && open) {
        open(overlay.id);
        return;
      }
      const feature = hit(event.point);
      const selection = feature ? toSelection(feature) : null;
      resolvedRef.current = selection?.id ?? null;
      callbacks.current.onSelect(selection);
      if (!selection) callbacks.current.onPoint?.({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    });
    const clearHover = (): void => {
      const previous = hoveredRef.current;
      if (previous && map.getSource(previous.source)) {
        map.removeFeatureState(previous, "hover");
      }
      hoveredRef.current = null;
      delete map.getContainer().dataset.hovered;
      if (tooltipRef.current) tooltipRef.current.hidden = true;
    };
    const showTooltip = (feature: MapGeoJSONFeature, point: Point): void => {
      const selection = toSelection(feature);
      if (selection) placeTooltip(tooltipFor(selection, i18nRef.current), point);
    };
    const placeTooltip = (
      { title, detail }: { title: string; detail: string | null },
      point: Point,
    ): void => {
      const tip = tooltipRef.current;
      if (!tip) return;
      const [titleEl, detailEl] = tip.children;
      if (titleEl) titleEl.textContent = title;
      if (detailEl) {
        detailEl.textContent = detail ?? "";
        (detailEl as HTMLElement).hidden = detail === null;
      }
      tip.hidden = false;
      // keep it inside the map: flip to the left of the pointer near the right edge, above near the bottom
      const { clientWidth, clientHeight } = map.getContainer();
      const x =
        point.x + TOOLTIP_OFFSET_PX + tip.offsetWidth > clientWidth
          ? point.x - TOOLTIP_OFFSET_PX - tip.offsetWidth
          : point.x + TOOLTIP_OFFSET_PX;
      const y =
        point.y + TOOLTIP_OFFSET_PX + tip.offsetHeight > clientHeight
          ? point.y - TOOLTIP_OFFSET_PX - tip.offsetHeight
          : point.y + TOOLTIP_OFFSET_PX;
      tip.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
    };
    // the time machine's plants from the timeline are not in the tiles: a tooltip, nothing to select
    const timelineHit = (point: Point): { title: string; detail: string | null } | null => {
      const layers = TIMELINE_LAYERS.filter((layer) => map.getLayer(layer));
      if (layers.length === 0) return null;
      const feature = map.queryRenderedFeatures(point, { layers })[0];
      return feature ? timelineTooltip(feature.properties, i18nRef.current) : null;
    };
    map.on("mousemove", (event) => {
      const feature = hit(event.point);
      map.getCanvas().style.cursor = feature || overlayHit(event.point) ? "pointer" : "";
      const id: unknown = feature?.properties.id;
      if (!feature || typeof id !== "string") {
        clearHover();
        const retired = timelineHit(event.point);
        if (retired) placeTooltip(retired, event.point);
        return;
      }
      if (hoveredRef.current?.id !== id) {
        clearHover();
        const next: Hovered = { source: feature.source, sourceLayer: feature.sourceLayer ?? "", id };
        map.setFeatureState(next, { hover: true });
        hoveredRef.current = next;
        map.getContainer().dataset.hovered = id;
      }
      showTooltip(feature, event.point);
    });
    map.on("mouseout", clearHover);
    map.on("movestart", clearHover);
    map.on("moveend", () => {
      if (introActiveRef.current) return;
      const center = map.getCenter();
      callbacks.current.onViewChange({ lng: center.lng, lat: center.lat, zoom: map.getZoom() });
    });
    map.on("error", (event) => {
      console.error("[map]", event.error);
    });
    // A link may carry a selection whose details are not known yet: resolve it from loaded tiles.
    map.on("idle", () => {
      settledRef.current = true;
      setIdleStyle(appliedStyle.current);
      if (introActiveRef.current && !introReadyRef.current && appliedStyle.current) {
        introReadyRef.current = true;
        callbacks.current.onIntroReady?.();
      }
      const seen = inView(map);
      if (!sameInView(seen, inViewRef.current)) {
        inViewRef.current = seen;
        callbacks.current.onInView(seen);
      }
      const selected = selectedRef.current;
      if (!selected || selected === resolvedRef.current || !map.getSource(GRID_SOURCE)) return;
      for (const { source, sourceLayer } of SELECTABLE) {
        if (!map.getSource(source)) continue;
        const [found] = map.querySourceFeatures(source, {
          sourceLayer,
          filter: ["==", ["get", "id"], selected],
        });
        const selection = found ? fromProperties(sourceLayer, found.properties) : null;
        if (selection) {
          resolvedRef.current = selection.id;
          callbacks.current.onSelect(selection);
          return;
        }
      }
    });

    // The drawing buffer is only readable while MapLibre paints, so the copy is taken in the render
    // event of a repaint asked for on purpose; keeping the buffer around permanently costs every frame.
    const captureCanvas = (): Promise<HTMLCanvasElement> =>
      new Promise((resolve, reject) => {
        map.once("render", () => {
          const source = map.getCanvas();
          const copy = document.createElement("canvas");
          copy.width = source.width;
          copy.height = source.height;
          const context = copy.getContext("2d");
          if (!context) {
            reject(new Error("2D canvas is not available"));
            return;
          }
          context.drawImage(source, 0, 0);
          resolve(copy);
        });
        map.triggerRepaint();
      });

    mapRef.current = map;
    onReady({
      flyTo: (lng, lat, zoom) => {
        map.flyTo({ center: [lng, lat], zoom, essential: true });
      },
      showTraveller: (traveller) => {
        const source = map.getSource(TRAVEL_SOURCE);
        if (!(source instanceof GeoJSONSource)) return;
        // the data is set at once; the promise only reports when the map has drawn it
        void source.setData(
          traveller === null
            ? { type: "FeatureCollection", features: [] }
            : {
                type: "FeatureCollection",
                features: [
                  {
                    type: "Feature",
                    properties: {},
                    geometry: { type: "LineString", coordinates: traveller.trail },
                  },
                  {
                    type: "Feature",
                    properties: {},
                    geometry: { type: "Point", coordinates: traveller.head },
                  },
                ],
              },
        );
      },
      travelTo: (lng, lat, zoom, tilt) => {
        // not `essential`: MapLibre then jumps instead of flying under prefers-reduced-motion. Every move
        // names its pitch and bearing, so a step after a tilted one is flat again without being told.
        map.flyTo({
          center: [lng, lat],
          zoom,
          pitch: tilt?.pitch ?? 0,
          bearing: tilt?.bearing ?? 0,
          speed: 0.9,
          curve: 1.3,
        });
      },
      level: () => {
        // only when there is something to undo: a move that changes nothing would still report a new view
        if (map.getPitch() !== 0 || map.getBearing() !== 0) map.easeTo({ pitch: 0, bearing: 0 });
      },
      snapshot: async () => {
        const canvas = await captureCanvas();
        const { attribution: credits, basemap: kind } = creditsRef.current;
        const basemapCredit = kind ? BASEMAP_CREDIT[kind] : "";
        const css = getComputedStyle(map.getContainer());
        const composed = composeSnapshot(
          canvas,
          {
            title: `${i18nRef.current.t("appName")} · ${i18nRef.current.date(new Date().toISOString())}`,
            attribution: [credits, basemapCredit].filter(Boolean).join(" | "),
          },
          {
            background: css.getPropertyValue("--surface").trim() || "#eef0f1",
            ink: css.getPropertyValue("--ink").trim() || "#1e262e",
            muted: css.getPropertyValue("--muted").trim() || "#5e6a75",
            font: css.getPropertyValue("--font").trim() || "system-ui, sans-serif",
          },
          window.devicePixelRatio || 1,
        );
        return canvasToBlob(composed);
      },
    });
    return () => {
      chrome?.disconnect();
      shell?.style.removeProperty("--map-chrome");
      mapRef.current = null;
      map.remove();
    };
    // The map is created once; later changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the basemap for the current theme.
  useEffect(() => {
    let cancelled = false;
    void loadBasemap(maptilerKey, theme, palette).then((value) => {
      if (cancelled) return;
      setBasemap({ theme, value });
      onBasemap(value.kind);
    });
    return () => {
      cancelled = true;
    };
  }, [maptilerKey, theme, palette, onBasemap]);

  // Read before the style: colour changes between hours fade, unless the visitor asked for reduced motion.
  const reducedMotion = useReducedMotion();
  // What the style is made of. A pan changes only `state.view`, so it no longer rebuilds the style and makes
  // MapLibre diff it after every move; StyleState's type keeps this list complete.
  const styleState: StyleState = useMemo(
    () => ({
      layers: state.layers,
      statuses: state.statuses,
      technologies: state.technologies,
      voltages: state.voltages,
      minMw: state.minMw,
      countries: state.countries,
      year: state.year,
      lang: state.lang,
      live: state.live,
      selected: state.selected,
    }),
    [
      state.layers,
      state.statuses,
      state.technologies,
      state.voltages,
      state.minMw,
      state.countries,
      state.year,
      state.lang,
      state.live,
      state.selected,
    ],
  );
  const style: StyleSpecification | null = useMemo(() => {
    if (basemap?.theme !== theme) return null;
    const { value } = basemap;
    // one decision per opt-in archive: no source is declared for a layer that is not drawn, and vice versa
    const optIn = optedIn(tiles, styleState.layers);
    const layers = dataLayers({
      state: styleState,
      palette,
      labels: value.fonts,
      maskOutside: value.kind === "maptiler",
      optIn,
      livePrices: live?.prices ?? null,
      spotlight,
      around,
      solar: solar !== null,
      chargerOverviewBelow:
        tiles.chargerOverview !== undefined && tiles.chargers ? tiles.chargers.minZoom : null,
    });
    const composed = composeStyle(
      value.style,
      dataSources(tiles, { live: live?.features ?? null, gas, timeline, geothermal, capacity, solar }, optIn),
      stage === null ? layers : introLayers(layers, stage, palette),
      reducedMotion,
    );
    // without the intro the style is exactly what it always was
    if (stage === null) return composed;
    const label = Object.fromEntries(SCOPE_COUNTRIES.map((code) => [code, i18n.country(code)])) as Record<
      CountryCode,
      string
    >;
    return introStyle(composed, {
      stage,
      globe: flight?.plan.globe ?? null,
      palette,
      names: value.fonts ? { label, fonts: value.fonts } : null,
    });
  }, [
    basemap,
    theme,
    tiles,
    styleState,
    palette,
    live,
    gas,
    timeline,
    geothermal,
    capacity,
    solar,
    reducedMotion,
    stage,
    flight,
    spotlight,
    around,
    i18n,
  ]);

  // The intro plays: two legs from the globe (one on a phone), the grid's stages on timers, then "settle".
  useEffect(() => {
    const map = mapRef.current;
    if (intro !== "play" || !map || !flight) return;
    let cancelled = false;
    const timers: number[] = INTRO_STAGE_AT.slice(1).map((share, index) =>
      window.setTimeout(() => {
        setIntroStage((index + 1) as IntroStage);
      }, share * flight.plan.totalMs),
    );
    const fly = (leg: Flight["legs"][number], first: boolean): Promise<void> =>
      new Promise((resolve) => {
        map.once("moveend", () => {
          resolve();
        });
        const options = { ...leg.to, duration: leg.durationMs, essential: false };
        // from the globe a flight arcs out and back in; the last stretch is a plain glide
        if (first && flight.plan.globe) map.flyTo({ ...options, curve: 1.3 });
        else map.easeTo(options);
      });
    const run = async (): Promise<void> => {
      for (const [index, leg] of flight.plan.legs.entries()) {
        await fly(leg, index === 0);
        if (cancelled) return;
      }
      timers.push(
        window.setTimeout(() => {
          setIntroStage(INTRO_SETTLE);
          callbacks.current.onIntroDone?.();
        }, SETTLE_DELAY_MS),
      );
    };
    void run();
    return () => {
      cancelled = true;
      timers.forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, [intro, flight]);

  // The intro ends (done, skipped, or given up on): the camera is put on the usual first view if it is not
  // there yet, the limits come back, and the next style is the ordinary one.
  useEffect(() => {
    const map = mapRef.current;
    if (intro !== null || !map || !introActiveRef.current) return;
    map.stop();
    if (introFinalRef.current) map.jumpTo(introFinalRef.current);
    map.setMaxBounds(regionMaxBounds(regionBounds));
    map.setMinZoom(MIN_ZOOM);
    introActiveRef.current = false;
  }, [intro, regionBounds]);

  // One code path for every change: MapLibre diffs the style and only applies what changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!style || !map) return;
    appliedStyle.current = style;
    settledRef.current = false;
    map.setStyle(style, { diff: true });
    // A diff that changes nothing may not trigger a new render; ask for one so "idle" always follows.
    map.triggerRepaint();
  }, [style]);

  const status = style !== null && idleStyle === style ? "ready" : "loading";

  // Flow direction as motion. The loop only runs while the live layer is on, the tab is visible and the
  // visitor has not asked for reduced motion; it changes one paint property, at most once per frame.
  const animateFlows = live !== null && state.live && !reducedMotion;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    if (live === null || !state.live) delete container.dataset.flowAnimation;
    else container.dataset.flowAnimation = reducedMotion ? "reduced" : "running";
    if (!animateFlows) return;
    const startedAt = performance.now();
    let frame = 0;
    let lastStep = -1;
    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || !settledRef.current) return;
      const step = stepAt(now, startedAt, FLOW_STEPS, FLOW_CYCLE_MS);
      if (step === lastStep || !map.getLayer(FLOW_DASH_LAYER)) return;
      lastStep = step;
      map.setPaintProperty(FLOW_DASH_LAYER, "line-dasharray", [...stepPattern(step)]);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [animateFlows, live, state.live, reducedMotion]);

  // The grid breathes (glowBreath.ts): now and then the glow under the lines swells and settles. Between
  // breaths nothing is scheduled and the map rests.
  const breathing = breathes({
    resting: palette.lineGlow,
    linesShown: state.layers.has("lines"),
    reducedMotion,
    intro: stage !== null,
    spotlight: spotlight !== null,
  });
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !breathing) return;
    const resting = palette.lineGlow;
    const peak = breathPeak(resting);
    let step = 0;
    const steps = Math.round((2 * BREATH_FADE_MS) / BREATH_STEP_MS);
    let fade: number | undefined;
    const breathe = (): void => {
      if (document.hidden || !settledRef.current || !map.getLayer(LINE_GLOW_LAYER)) return;
      step = 0;
      window.clearInterval(fade);
      fade = window.setInterval(() => {
        step += 1;
        // up and down along one smooth hump, ending exactly where it began
        const lift = Math.sin((Math.PI * step) / steps) ** 2;
        const done = step >= steps;
        if (map.getLayer(LINE_GLOW_LAYER)) {
          map.setPaintProperty(
            LINE_GLOW_LAYER,
            "line-opacity",
            done ? resting : resting + (peak - resting) * lift,
          );
        }
        if (done) window.clearInterval(fade);
      }, BREATH_STEP_MS);
    };
    const timer = window.setInterval(breathe, BREATH_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(fade);
      // a breath cut short must not leave the glow half-way up
      if (map.getLayer(LINE_GLOW_LAYER)) map.setPaintProperty(LINE_GLOW_LAYER, "line-opacity", resting);
    };
  }, [breathing, palette.lineGlow]);

  // A new selection announces itself: every selection ring swells twice and settles, so the eye finds
  // the object among hundreds of points. One short loop, never while the style is still settling, and
  // nothing at all for a visitor who asked for reduced motion (the ring alone is the signal then).
  useEffect(() => {
    const map = mapRef.current;
    const selected = state.selected;
    if (!map || selected === null) return;
    const container = map.getContainer();
    const rings = (): string[] =>
      map
        .getStyle()
        .layers.filter((layer) => layer.id.endsWith(SELECTED_RING_SUFFIX) && layer.type === "circle")
        .map((layer) => layer.id);
    const setWidth = (width: number): void => {
      for (const id of rings()) if (map.getLayer(id)) map.setPaintProperty(id, "circle-stroke-width", width);
    };
    if (reducedMotion) {
      container.dataset.selectionPulse = "reduced";
      return;
    }
    container.dataset.selectionPulse = "running";
    let frame = 0;
    let startedAt: number | null = null;
    const tick = (now: number): void => {
      if (!settledRef.current) {
        frame = requestAnimationFrame(tick);
        return;
      }
      startedAt ??= now;
      const elapsed = now - startedAt;
      if (elapsed >= SELECTION_PULSE_MS) {
        setWidth(SELECTED_RING_STROKE);
        container.dataset.selectionPulse = "done";
        return;
      }
      setWidth(pulseWidth(elapsed));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // effects clean up in order: on unmount the map is already gone by the time this runs
      if (mapRef.current === map) setWidth(SELECTED_RING_STROKE);
    };
  }, [state.selected, reducedMotion]);

  // Numbers for flows and prices as HTML markers: they need no map fonts (the fallback basemap has none).
  // The same figures are available as a table in the live bar, so markers are hidden from screen readers.
  useEffect(() => {
    const map = mapRef.current;
    // during the intro the flows are a picture only; their numbers belong to the live layer
    if (!map || !live || intro !== null) return;
    const markers = live.labels.map((label) => {
      const element = document.createElement("div");
      element.className = label.kind === "flow" ? (styles.flowLabel ?? "") : (styles.priceLabel ?? "");
      element.setAttribute("aria-hidden", "true");
      element.dataset.liveLabel = label.key;
      element.textContent =
        label.kind === "flow"
          ? `${i18n.number(label.mw ?? 0)} ${i18n.t("unitMw")}`
          : `${i18n.number(label.eur ?? 0)} ${i18n.t("unitEurMwh")}`;
      return new Marker({ element, anchor: "center" }).setLngLat([label.lng, label.lat]).addTo(map);
    });
    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [live, i18n, intro]);

  return (
    <div
      ref={container}
      className={styles.map}
      role="region"
      aria-label={t("appName")}
      data-map-status={status}
      data-basemap={basemap?.value.kind ?? "loading"}
      data-intro={intro ?? undefined}
    >
      <div ref={tooltipRef} className={styles.tooltip} hidden data-map-tooltip>
        <span className={styles.tooltipTitle} />
        <span className={styles.tooltipDetail} />
      </div>
    </div>
  );
}
