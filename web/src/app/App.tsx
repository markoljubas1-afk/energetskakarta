import { ExternalLink, SlidersHorizontal, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppConfig } from "../config";
import { gasOverlay, loadGas, type GasLoad } from "../data/gas";
import { loadLive, overlay, pickHour } from "../data/live";
import { GEOTHERMAL_KEY, geothermalFeatures, loadGeothermal, type GeothermalLoad } from "../data/geothermal";
import { capacityOverlay, HEP_KEYS, loadHep, type HepLoad } from "../data/hep";
import { loadTimeline, retiredFeatures } from "../data/timeline";
import { DATA_SOURCES, isOneOf, type DataSource, type LayerKey } from "../domain";
import { assetUrl, loadCurrent, type Current } from "../data/current";
import type { SearchHit } from "../data/search";
import { I18nProvider, useI18n } from "../i18n";
import type { Basemap } from "../map/basemap";
import type { InView } from "../map/inView";
import { NOTHING_IN_VIEW } from "../map/inView";
import type { Spotlight } from "../map/spotlight";
import type { TileUrls } from "../map/layers";
import type { MapApi } from "../map/MapView";
import type { Selection } from "../map/selection";
import type { Locate } from "../panels/ChangesPanel";
import { DetailsPanel } from "../panels/DetailsPanel";
import { ShortcutsHelp } from "../panels/ShortcutsHelp";
import { Header } from "../panels/Header";
import { Legend } from "../panels/Legend";
import { LiveBar } from "../panels/LiveBar";
import { SearchBox } from "../panels/SearchBox";
import { SidePanel } from "../panels/SidePanel";
import { CapacityBar } from "../panels/CapacityBar";
import { GeothermalBar } from "../panels/GeothermalBar";
import { StatusBar } from "../panels/StatusBar";
import { TimeBar } from "../panels/TimeBar";
import { useWelcome, Welcome, type WelcomeEntries } from "../panels/Welcome";
import { pathForLang, serializeState, useUrlState, type AppState, type Page, type View } from "../state/url";
import styles from "./App.module.css";
import { ErrorBoundary } from "./ErrorBoundary";
import { Intro } from "./Intro";
import { ErrorScreen, LoadingScreen } from "./Screens";
import { useShortcuts, type Shortcut } from "./shortcuts";
import { useAsync } from "./useAsync";
import { useOverlay } from "./useOverlay";
import { useHourClock } from "./useHourClock";
import { useIntro, type IntroControl } from "./useIntro";
import { useTheme } from "./theme";

/** How often an open map reloads the live layer (the pipeline publishes hourly, at :12). */
const LIVE_REFRESH_MS = 15 * 60_000;

// The energy view brings Chart.js; it is only loaded when someone opens it.
const EnergyView = lazy(() =>
  import("../energy/EnergyView").then((module) => ({ default: module.EnergyView })),
);

// MapLibre is by far the largest dependency; the shell and search render before it arrives.
const MapView = lazy(() => import("../map/MapView").then((module) => ({ default: module.MapView })));

/** The same view on the full site: what an embedded map links to, and what a host page's readers open. */
function fullSiteHref(state: AppState): string {
  return `${window.location.origin}${pathForLang(state.lang)}${serializeState({ ...state, embed: false }, state.lang)}`;
}

/** Zoom used when jumping to a search result; every point asset is visible from here (tiles.py rules). */
const SEARCH_ZOOM = 11;

const LAYER_OF_HIT = {
  plant: "plants",
  substation: "substations",
  datacenter: "datacenters",
  city: "cities",
  extraction: "extraction",
} as const satisfies Record<SearchHit["kind"], LayerKey>;

const LAYER_OF_SELECTION = {
  line: "lines",
  cable: "lines",
  substation: "substations",
  pipeline: "pipelines",
  charger: "chargers",
  extraction: "extraction",
  datacenter: "datacenters",
  plant: "plants",
  city: "cities",
  gas: "gas",
} as const satisfies Record<Selection["kind"], LayerKey>;

/** Map features of each optional layer's release; module-level so they are stable (useOverlay). */
type Ready<L> = Extract<L, { kind: "ready" }>;
const gasFeaturesOf = (loaded: Ready<GasLoad>) => gasOverlay(loaded.gas);
const geoFeaturesOf = (loaded: Ready<GeothermalLoad>) => geothermalFeatures(loaded.geothermal);
const capFeaturesOf = (loaded: Ready<HepLoad>) => capacityOverlay(loaded.release);

export function App({ config }: { config: AppConfig }) {
  const [state, setState] = useUrlState();
  return (
    <I18nProvider lang={state.lang}>
      <Shell config={config} state={state} setState={setState} />
    </I18nProvider>
  );
}

interface ShellProps {
  config: AppConfig;
  state: AppState;
  setState: (update: (state: AppState) => AppState) => void;
}

function Shell({ config, state, setState }: ShellProps) {
  const { t, lang } = useI18n();
  const [current, retry] = useAsync("current.json", (signal) => loadCurrent(config.dataBaseUrl, signal));
  // the first-visit intro (Faza 22); it is night while it plays, whatever the theme
  const intro = useIntro(lang, current?.status === "error");
  const [theme, toggleTheme] = useTheme(intro.theme);

  useEffect(() => {
    document.documentElement.lang = lang;
    // the descriptive title, not just the name: it is what the tab and search results show (todo 16-A2)
    document.title = t("documentTitle");
  }, [lang, t]);

  const setPage = useCallback(
    (page: Page) => {
      setState((s) => ({ ...s, page }));
    },
    [setState],
  );
  const toggleLang = useCallback(() => {
    setState((s) => ({ ...s, lang: s.lang === "hr" ? "en" : "hr" }));
  }, [setState]);

  // Search lives in the header, the map in <main>; both share this handle.
  const map = useRef<MapHandle>({ api: null, zoom: 0 });
  const onPick = useCallback(
    (hit: SearchHit) => {
      // picking a result also switches its layer on, so the map can never fly to something invisible
      const layer = LAYER_OF_HIT[hit.kind];
      setState((s) => ({ ...s, selected: hit.id, layers: new Set([...s.layers, layer]) }));
      map.current.api?.flyTo(hit.lon, hit.lat, Math.max(map.current.zoom, SEARCH_ZOOM));
    },
    [setState],
  );

  // A change-report example: switch its layer on, fly there, and select it if it still exists.
  const onLocate = useCallback(
    (target: Locate) => {
      setState((s) => ({ ...s, selected: target.id, layers: new Set([...s.layers, target.layer]) }));
      map.current.api?.flyTo(target.lon, target.lat, Math.max(map.current.zoom, SEARCH_ZOOM));
    },
    [setState],
  );

  const onMapReady = useCallback((api: MapApi | null) => {
    map.current.api = api;
  }, []);
  const onMapZoom = useCallback((zoom: number) => {
    map.current.zoom = zoom;
  }, []);

  const search =
    current?.status === "ready" ? (
      <SearchBox indexUrl={assetUrl(config.dataBaseUrl, current.value.search)} onPick={onPick} />
    ) : null;

  // Single-key shortcuts (shortcuts.ts). Escape is handled where the panels live (Explorer).
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
  }, []);
  const onMap = state.page === "map";
  // inside someone else's page the host owns the keyboard; only Escape (in Explorer) stays
  const shortcuts = useMemo<Partial<Record<Shortcut, () => void>>>(
    () => ({
      ...(state.embed
        ? {}
        : {
            help: () => {
              setHelpOpen((open) => !open);
            },
            theme: toggleTheme,
          }),
      ...(onMap && !state.embed
        ? {
            search: () => {
              document.querySelector<HTMLElement>('[data-shortcut="search"]')?.focus();
            },
            live: () => {
              setState((s) => ({ ...s, live: !s.live }));
            },
          }
        : {}),
    }),
    [onMap, setState, state.embed, toggleTheme],
  );
  useShortcuts(shortcuts);

  return (
    <div
      className={styles.app}
      data-embed={state.embed || undefined}
      data-intro={
        intro.phase === "title" || intro.phase === "play"
          ? "on"
          : intro.phase === "handoff"
            ? "handoff"
            : undefined
      }
    >
      {!state.embed && (
        <Header
          theme={theme}
          page={state.page}
          onPage={setPage}
          onToggleTheme={toggleTheme}
          onToggleLang={toggleLang}
        >
          {search}
        </Header>
      )}
      <main id="map" className={styles.main} tabIndex={-1}>
        {(current === null || current.status === "loading") && <LoadingScreen label={t("loadingData")} />}
        {current?.status === "error" && (
          <ErrorScreen title={t("dataFailedTitle")} body={t("dataFailedBody")} onRetry={retry} />
        )}
        {current?.status === "ready" && (
          <Explorer
            config={config}
            current={current.value}
            state={state}
            setState={setState}
            theme={theme}
            onMapReady={onMapReady}
            onMapZoom={onMapZoom}
            onLocate={onLocate}
            intro={intro}
          />
        )}
      </main>
      {intro.phase !== "done" && <Intro mode={intro.mode} phase={intro.phase} onSkip={intro.skip} />}
      <ShortcutsHelp open={helpOpen} onClose={closeHelp} />
    </div>
  );
}

/** Live map controls plus the last known zoom, shared between the search box and the map. */
interface MapHandle {
  api: MapApi | null;
  zoom: number;
}

interface ExplorerProps extends ShellProps {
  current: Current;
  theme: "light" | "dark";
  onMapReady: (api: MapApi | null) => void;
  onMapZoom: (zoom: number) => void;
  onLocate: (target: Locate) => void;
  intro: IntroControl;
}

function Explorer({
  config,
  current,
  state,
  setState,
  theme,
  onMapReady,
  onMapZoom,
  onLocate,
  intro,
}: ExplorerProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const sources: DataSource[] = [
    ...(current.attributionSources ?? ["openstreetmap", "naturalearth"]).filter(
      (source): source is DataSource => isOneOf(DATA_SOURCES, source),
    ),
    // the gas layer's data is not part of the build: credited only while it is shown
    ...(state.layers.has("gas") ? (["entsog"] as const) : []),
  ];
  const [details, setDetails] = useState<Selection | null>(null);
  const [basemap, setBasemap] = useState<Basemap["kind"] | null>(null);
  // the map's controls, for the share menu here and for search in the header (via onMapReady)
  const [mapApi, setMapApi] = useState<MapApi | null>(null);
  const onReady = useCallback(
    (api: MapApi) => {
      setMapApi(api);
      onMapReady(api);
    },
    [onMapReady],
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  // Escape peels one layer at a time: the details first, then the settings sheet.
  const escape = useMemo<Partial<Record<Shortcut, () => void>>>(
    () => ({
      escape: () => {
        if (state.selected) setState((s) => ({ ...s, selected: null }));
        else if (sheetOpen) setSheetOpen(false);
      },
    }),
    [state.selected, sheetOpen, setState, setSheetOpen],
  );
  useShortcuts(escape);

  const tiles: TileUrls = useMemo(
    () => ({
      grid: assetUrl(config.dataBaseUrl, current.tiles.grid.url),
      boundaries: assetUrl(config.dataBaseUrl, current.tiles.boundaries.url),
      gridMaxZoom: current.tiles.grid.maxZoom,
      boundariesMaxZoom: current.tiles.boundaries.maxZoom,
      ...(current.tiles.distribution
        ? {
            distribution: {
              url: assetUrl(config.dataBaseUrl, current.tiles.distribution.url),
              minZoom: current.tiles.distribution.minZoom,
              maxZoom: current.tiles.distribution.maxZoom,
            },
          }
        : {}),
      ...(current.tiles.chargers
        ? {
            chargers: {
              url: assetUrl(config.dataBaseUrl, current.tiles.chargers.url),
              minZoom: current.tiles.chargers.minZoom,
              maxZoom: current.tiles.chargers.maxZoom,
            },
          }
        : {}),
      ...(current.tiles.extraction
        ? {
            extraction: {
              url: assetUrl(config.dataBaseUrl, current.tiles.extraction.url),
              minZoom: current.tiles.extraction.minZoom,
              maxZoom: current.tiles.extraction.maxZoom,
            },
          }
        : {}),
    }),
    [config.dataBaseUrl, current],
  );

  // Live flows and prices: loaded only while the layer is on; the bar and the map share one copy. The
  // pipeline publishes every hour, so an open map reloads in the background and follows the current hour.
  // the intro shows the flows for a moment when the hour's data is there; the live layer stays off
  const introFlows = intro.map !== null;
  // The welcome card lives in the details slot until the reader has used the map.
  const [welcomeShown, dismissWelcome] = useWelcome(state.embed, state.selected);
  // the card's first door is the live layer only when there is something behind it, so it asks too
  const [liveData, retryLive] = useAsync(
    state.live || introFlows || welcomeShown ? "live/current.json" : null,
    (signal) => loadLive(config.dataBaseUrl, signal),
    { refreshMs: LIVE_REFRESH_MS },
  );
  const liveNow = useHourClock(state.live);
  const liveDoc =
    liveData?.status === "ready" && liveData.value.kind === "ready" ? liveData.value.live : null;
  const livePublished = liveDoc !== null;
  const liveIndex = liveDoc ? pickHour(liveDoc, state.liveHour, liveNow) : 0;
  const liveOverlay = useMemo(
    () => ((state.live || introFlows) && liveDoc ? overlay(liveDoc, liveIndex) : null),
    [state.live, introFlows, liveDoc, liveIndex],
  );
  // what the map draws: during the intro, the flows as if the layer were on (the link and panels are untouched)
  const mapState = useMemo(
    () => (introFlows && liveOverlay ? { ...state, live: true } : state),
    [introFlows, liveOverlay, state],
  );
  // Optional layers (gas, geothermal, HEP ODS capacity) load only while they are on (app/useOverlay.ts).
  // A geothermal site or a substation picked on the map or in its bar is a moment, not a view: not in the URL.
  const gasOn = state.layers.has("gas");
  const { features: gasFeatures } = useOverlay(
    gasOn ? "live/gas.json" : null,
    (signal) => loadGas(config.dataBaseUrl, signal),
    gasFeaturesOf,
  );
  const geoOn = state.layers.has("geothermal");
  const {
    data: geoData,
    retry: retryGeo,
    features: geoFeatures,
  } = useOverlay(
    geoOn ? GEOTHERMAL_KEY : null,
    (signal) => loadGeothermal(config.dataBaseUrl, signal),
    geoFeaturesOf,
  );
  const [geoSite, setGeoSite] = useState<string | null>(null);
  // the map needs the release only; the history is the capacity pages'
  const capOn = state.layers.has("capacity");
  const {
    data: capData,
    retry: retryCap,
    features: capFeatures,
  } = useOverlay(
    capOn ? HEP_KEYS.current : null,
    (signal) => loadHep(config.dataBaseUrl, signal, { history: false }),
    capFeaturesOf,
  );
  const [capStation, setCapStation] = useState<string | null>(null);
  // Time machine (Faza 18-3): the timeline loads while the bar is open; the tiles' plants are filtered by
  // the year in the map style, and retired plants come from the timeline as their own small source.
  const timelineKey = state.year !== null ? (current.timeline ?? null) : null;
  const [timelineData, retryTimeline] = useAsync(timelineKey, (signal) =>
    loadTimeline(config.dataBaseUrl, timelineKey ?? "", signal),
  );
  const timelineScope = useMemo(
    () => ({ countries: state.countries, technologies: state.technologies }),
    [state.countries, state.technologies],
  );
  const timelineFeatures = useMemo(
    () =>
      state.year !== null && timelineData?.status === "ready"
        ? retiredFeatures(timelineData.value, timelineScope, state.year)
        : null,
    [state.year, timelineData, timelineScope],
  );
  const onYear = useCallback(
    (year: number | null) => {
      setState((s) => ({ ...s, year }));
    },
    [setState],
  );
  const onLiveHour = useCallback(
    (key: string) => {
      setState((s) => ({ ...s, liveHour: key }));
    },
    [setState],
  );
  const closeLive = useCallback(() => {
    setState((s) => ({ ...s, live: false }));
  }, [setState]);

  // Details belong to one id; a stale object is never shown for a different selection.
  const shownDetails = details?.id === state.selected ? details : null;

  const onSelect = useCallback(
    (selection: Selection | null) => {
      setDetails(selection);
      // a link to an object whose layer is off (most are, by default) switches that layer on: the details
      // of something that is not on the map would read as a mistake
      const layer = selection ? LAYER_OF_SELECTION[selection.kind] : null;
      setState((s) => ({
        ...s,
        selected: selection?.id ?? null,
        layers: layer && !s.layers.has(layer) ? new Set([...s.layers, layer]) : s.layers,
      }));
    },
    [setState],
  );
  const onViewChange = useCallback(
    (view: View) => {
      onMapZoom(view.zoom);
      setState((s) => ({ ...s, view }));
    },
    [onMapZoom, setState],
  );
  // the map is removed with this component; search must not fly a removed map
  useEffect(
    () => () => {
      onMapReady(null);
    },
    [onMapReady],
  );
  // on a phone the settings sheet covers the map; a reader who picked a place wants to see it
  const locateAndShowMap = useCallback(
    (target: Locate) => {
      setSheetOpen(false);
      onLocate(target);
    },
    [onLocate, setSheetOpen],
  );
  // what is on screen, for the legend; the map reports it only when it changes
  const [seen, setSeen] = useState<InView>(NOTHING_IN_VIEW);
  // what a legend or overview row lights on the map while it is pointed at; never part of the link
  const [spotlight, setSpotlight] = useState<Spotlight>(null);
  const welcomeEntries = useMemo<WelcomeEntries>(
    () => ({
      live: livePublished
        ? () => {
            setState((s) => ({ ...s, live: true }));
          }
        : null,
      capacity: () => {
        setState((s) => ({ ...s, layers: new Set([...s.layers, "capacity"]) }));
      },
      changes: current.diff
        ? () => {
            setState((s) => ({ ...s, panel: "changes" }));
            setSheetOpen(true);
          }
        : null,
      cities: () => {
        setState((s) => ({ ...s, layers: new Set([...s.layers, "cities"]), panel: "overview" }));
      },
    }),
    [setState, setSheetOpen, current.diff, livePublished],
  );

  const closeCapacity = useCallback(() => {
    setCapStation(null);
    setState((s) => ({ ...s, layers: new Set([...s.layers].filter((layer) => layer !== "capacity")) }));
  }, [setState, setCapStation]);

  const closeDetails = useCallback(() => {
    setState((s) => ({ ...s, selected: null }));
  }, [setState]);

  const panelFallback = (reset: () => void) => (
    <p className={styles.panelError} role="alert">
      {t("panelFailed")}{" "}
      <button type="button" className={styles.linkButton} onClick={reset}>
        {t("retry")}
      </button>
    </p>
  );

  return (
    <>
      <ErrorBoundary
        area="map"
        fallback={(reset) => (
          <ErrorScreen title={t("mapFailedTitle")} body={t("mapFailedBody")} onRetry={reset} />
        )}
      >
        <Suspense fallback={<LoadingScreen label={t("mapLoading")} />}>
          <MapView
            tiles={tiles}
            regionBounds={current.tiles.grid.bounds}
            spotlight={spotlight}
            maptilerKey={config.maptilerKey}
            live={liveOverlay}
            gas={gasFeatures}
            timeline={timelineFeatures}
            geothermal={geoFeatures}
            capacity={capFeatures}
            onCapacityStation={setCapStation}
            onGeothermalSite={setGeoSite}
            attribution={i18n.attribution(sources)}
            theme={theme}
            state={mapState}
            onViewChange={onViewChange}
            onInView={setSeen}
            onSelect={onSelect}
            onBasemap={setBasemap}
            onReady={onReady}
            intro={intro.map}
            onIntroReady={intro.onMapReady}
            onIntroDone={intro.onMapDone}
          />
        </Suspense>
      </ErrorBoundary>

      {state.page === "energy" ? (
        <ErrorBoundary area="energy" fallback={panelFallback}>
          <Suspense fallback={<LoadingScreen label={t("loadingData")} />}>
            <EnergyView
              dataBaseUrl={config.dataBaseUrl}
              energy={state.energy}
              setState={setState}
              theme={theme}
              embed={state.embed}
            />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <>
          {state.embed && (
            <a
              className={styles.embedLink}
              href={fullSiteHref(state)}
              target="_blank"
              rel="noopener"
              data-embed-link
            >
              {t("embedOpenFull")}
              <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            </a>
          )}
          {!state.embed && (
            <div className={styles.mobileBar}>
              <button
                type="button"
                className={styles.sheetToggle}
                aria-expanded={sheetOpen}
                aria-controls="settings-panel"
                onClick={() => {
                  setSheetOpen((open) => !open);
                }}
              >
                {sheetOpen ? (
                  <X size={16} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                )}
                {sheetOpen ? t("closeSettings") : t("openSettings")}
              </button>
            </div>
          )}

          {!state.embed && (
            <aside
              id="settings-panel"
              className={styles.side}
              data-open={sheetOpen}
              aria-label={t("panelLabel")}
            >
              <ErrorBoundary area="side-panel" fallback={panelFallback}>
                <SidePanel
                  state={state}
                  setState={setState}
                  statsUrl={assetUrl(config.dataBaseUrl, current.stats)}
                  diffUrl={current.diff ? assetUrl(config.dataBaseUrl, current.diff) : null}
                  onLocate={locateAndShowMap}
                  theme={theme}
                  timeMachine={current.timeline !== undefined}
                  emptyLayers={seen.emptyLayers}
                  onSpotlight={setSpotlight}
                  plantGridUrl={current.plantGrid ? assetUrl(config.dataBaseUrl, current.plantGrid) : null}
                  viewBounds={seen.bounds}
                />
              </ErrorBoundary>
            </aside>
          )}

          {welcomeShown && (
            <aside className={`${styles.details} ${styles.welcome}`}>
              <Welcome entries={welcomeEntries} onClose={dismissWelcome} support={config.support} />
            </aside>
          )}

          {state.selected && (
            <aside className={styles.details} aria-label={t("detailsLabel")}>
              <ErrorBoundary area="details" fallback={panelFallback}>
                <DetailsPanel id={state.selected} selection={shownDetails} onClose={closeDetails} />
              </ErrorBoundary>
            </aside>
          )}

          <div className={styles.legend}>
            <Legend
              theme={theme}
              compact={state.selected !== null || state.embed || welcomeShown}
              distribution={state.layers.has("distribution")}
              chargers={state.layers.has("chargers")}
              extraction={state.layers.has("extraction")}
              gas={state.layers.has("gas")}
              cities={state.layers.has("cities")}
              inView={seen}
              onSpotlight={setSpotlight}
            />
          </div>

          <div className={styles.dock}>
            {capOn && (
              <div className={styles.liveSlot}>
                <ErrorBoundary area="capacity" fallback={panelFallback}>
                  <CapacityBar
                    data={capData}
                    theme={theme}
                    selected={capStation}
                    onSelect={setCapStation}
                    onRetry={retryCap}
                    onClose={closeCapacity}
                  />
                </ErrorBoundary>
              </div>
            )}
            {geoOn && (
              <div className={styles.liveSlot}>
                <ErrorBoundary area="geothermal" fallback={panelFallback}>
                  <GeothermalBar
                    data={geoData}
                    theme={theme}
                    selected={geoSite}
                    onSelect={setGeoSite}
                    onRetry={retryGeo}
                  />
                </ErrorBoundary>
              </div>
            )}
            {state.year !== null && (
              <div className={styles.liveSlot}>
                <ErrorBoundary area="timeline" fallback={panelFallback}>
                  <TimeBar
                    data={timelineData}
                    year={state.year}
                    scope={timelineScope}
                    theme={theme}
                    onYear={onYear}
                    onRetry={retryTimeline}
                  />
                </ErrorBoundary>
              </div>
            )}
            {state.live && (
              <div className={styles.liveSlot}>
                <ErrorBoundary area="live" fallback={panelFallback}>
                  <LiveBar
                    data={liveData}
                    index={liveIndex}
                    theme={theme}
                    mapCenter={state.view}
                    onHour={onLiveHour}
                    onRetry={retryLive}
                    onClose={closeLive}
                  />
                </ErrorBoundary>
              </div>
            )}
            <StatusBar
              current={current}
              dataBaseUrl={config.dataBaseUrl}
              basemap={basemap}
              basemapExpected={config.maptilerKey !== null}
              map={mapApi}
            />
          </div>
        </>
      )}
    </>
  );
}
