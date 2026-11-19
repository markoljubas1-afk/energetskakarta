import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  SlidersHorizontal,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppConfig } from "../config";
import { gasOverlay, loadGas, type GasLoad } from "../data/gas";
import { GAS_STORAGE_KEY, loadGasStorage, storageOverlay } from "../data/gasStorage";
import { alerts, closedAlerts, rememberClosed, type Alert } from "../data/alerts";
import {
  hourKey,
  loadLive,
  overlay,
  pickHour,
  LIVE_DAYS_KEY,
  loadLiveDay,
  loadLiveDays,
  noonOf,
} from "../data/live";
import { GEOTHERMAL_KEY, geothermalFeatures, loadGeothermal, type GeothermalLoad } from "../data/geothermal";
import { capacityOverlay, HEP_KEYS, loadHep, type HepLoad } from "../data/hep";
import { loadTimeline, retiredFeatures } from "../data/timeline";
import {
  DATA_SOURCES,
  isOneOf,
  type CountryCode,
  type DataSource,
  type LayerKey,
  type Technology,
} from "../domain";
import { PATHS } from "../seo/pages";
import { assetUrl, loadCurrent, type Current } from "../data/current";
import type { SearchHit } from "../data/search";
import { I18nProvider, useI18n } from "../i18n";
import type { Basemap } from "../map/basemap";
import type { InView } from "../map/inView";
import { loadImages, photoOf } from "../data/images";
import { NOTHING_IN_VIEW } from "../map/inView";
import type { Spotlight } from "../map/spotlight";
import { StoryCard } from "../panels/StoryCard";
import { GreenLight } from "../panels/GreenLight";
import { GasStorageBar } from "../panels/GasStorageBar";
import { SolarBar } from "../panels/SolarBar";
import { HOME_KEY, loadHomeShapes } from "../data/homeFlow";
import { loadSolar, SOLAR_KEY, solarImage, type SolarLoad } from "../data/solar";
import { loadRoutes } from "../data/routes";
import { loadRenewables, RENEWABLES_KEY } from "../data/eurostat";
import { freshBands, mixNow } from "../data/greenShare";
import { HOUSEHOLDS_KEY, loadHouseholds } from "../data/households";
import { loadUsual, USUAL_KEY } from "../data/usual";
import { aroundOf, loadNearby } from "../data/nearby";
import { measure } from "../stories/travel";
import { useTravel } from "../stories/useTravel";
import { applyStep, leave, remember, sameBefore, STORIES, type Before } from "../stories/stories";
import type { TileUrls } from "../map/layers";
import type { MapApi } from "../map/MapView";
import type { Selection } from "../map/selection";
import type { Locate } from "../panels/ChangesPanel";
import { AlertBanner } from "../panels/AlertBanner";
import { DayCardDialog } from "../panels/DayCardDialog";
import { askedGasPicture } from "../share/gasCard";
import { askedPictureMonth } from "../share/sourcesCard";
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
import {
  askedSunPoint,
  pathForLang,
  TIME_MACHINE_START,
  serializeState,
  useUrlState,
  type AppState,
  type Page,
  type View,
} from "../state/url";
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
const solarOf = (loaded: Ready<SolarLoad>) => loaded.solar;
const capFeaturesOf = (loaded: Ready<HepLoad>) => capacityOverlay(loaded.release);

const SIDE_FOLDED_KEY = "gridatlas-side-folded";

function sideWasFolded(): boolean {
  try {
    return window.localStorage.getItem(SIDE_FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberSideFolded(folded: boolean): void {
  try {
    if (folded) window.localStorage.setItem(SIDE_FOLDED_KEY, "1");
    else window.localStorage.removeItem(SIDE_FOLDED_KEY);
  } catch {
    // no storage: the panel is simply open again on the next visit
  }
}

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
    ...(state.layers.has("gas") ? (["entsog", "gie"] as const) : []),
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
  // On a computer the panel of filters can be folded away to leave the map to itself; the choice is kept.
  const [sideFolded, setSideFolded] = useState(sideWasFolded);
  const foldSide = (folded: boolean): void => {
    setSideFolded(folded);
    rememberSideFolded(folded);
  };
  // What a guided story changes is remembered while no story plays, and given back when it ends.
  const [beforeStory, setBeforeStory] = useState<Before>(() => remember(state));
  if (state.story === null && !sameBefore(beforeStory, state)) setBeforeStory(remember(state));
  // Escape peels one layer at a time: the details first, then the settings sheet.
  const escape = useMemo<Partial<Record<Shortcut, () => void>>>(
    () => ({
      escape: () => {
        if (state.selected) setState((s) => ({ ...s, selected: null }));
        else if (sheetOpen) setSheetOpen(false);
        else if (state.story) setState((s) => leave(s, beforeStory));
      },
    }),
    [state.selected, state.story, beforeStory, sheetOpen, setState, setSheetOpen],
  );
  useShortcuts(escape);

  const tiles: TileUrls = useMemo(
    () => ({
      grid: assetUrl(config.dataBaseUrl, current.tiles.grid.url),
      boundaries: assetUrl(config.dataBaseUrl, current.tiles.boundaries.url),
      gridMaxZoom: current.tiles.grid.maxZoom,
      boundariesMaxZoom: current.tiles.boundaries.maxZoom,
      ...(current.chargerGrid ? { chargerOverview: assetUrl(config.dataBaseUrl, current.chargerGrid) } : {}),
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
    // always on the full site: the status bar says how green the electricity is right now (GreenLight)
    state.live || introFlows || welcomeShown || !state.embed ? "live/current.json" : null,
    (signal) => loadLive(config.dataBaseUrl, signal),
    { refreshMs: LIVE_REFRESH_MS },
  );
  const liveNow = useHourClock(state.live || !state.embed);
  const liveDoc =
    liveData?.status === "ready" && liveData.value.kind === "ready" ? liveData.value.live : null;
  const livePublished = liveDoc !== null;
  // The official yearly shares for the 2030 target in the green card: asked for when the card is first
  // opened, not on every visit. A failure only means no target is shown.
  const [wantGoal, setWantGoal] = useState(false);
  const askForGoal = useCallback(() => {
    setWantGoal(true);
  }, [setWantGoal]);
  const [renewables] = useAsync(wantGoal ? RENEWABLES_KEY : null, (signal) =>
    loadRenewables(config.dataBaseUrl, signal),
  );
  // the yardstick for the card's megawatts, asked for at the same moment; a failure only leaves it out
  const [households] = useAsync(wantGoal ? HOUSEHOLDS_KEY : null, (signal) =>
    loadHouseholds(config.dataBaseUrl, signal),
  );
  const [usual] = useAsync(wantGoal ? USUAL_KEY : null, (signal) => loadUsual(config.dataBaseUrl, signal));
  // Charging stations take the colour of how green their country's electricity is right now; without
  // fresh figures (or in an embed, which does not load them) they keep their own colour.
  const chargersOn = state.layers.has("chargers");
  const chargerBands = useMemo(() => {
    if (!chargersOn || !liveDoc) return null;
    const bands = freshBands(liveDoc, liveNow);
    return Object.keys(bands).length > 0 ? bands : null;
  }, [chargersOn, liveDoc, liveNow]);
  // A record day (data/live.ts): offered while the layer is on, and shown in place of today when the
  // link names one the list knows. The status bar's pill and the chargers keep to the real present.
  const [liveDays] = useAsync(state.live || !state.embed ? LIVE_DAYS_KEY : null, (signal) =>
    loadLiveDays(config.dataBaseUrl, signal),
  );
  const recordDays = liveDays?.status === "ready" ? liveDays.value : null;
  const recordDay = recordDays?.days.find((day) => day.date === state.liveDay) ?? null;
  // Something out of the ordinary gets one line above the map (data/alerts.ts): a price of zero or below
  // today or tomorrow, or a new record day. Closed notices are remembered and do not come back.
  const [closed, setClosed] = useState(closedAlerts);
  const alert =
    state.embed || state.live
      ? null
      : (alerts(liveDoc, recordDays, liveNow).find((each) => !closed.includes(each.id)) ?? null);
  const closeAlert = (each: Alert): void => {
    const next = [...closed, each.id];
    setClosed(next);
    rememberClosed(next);
  };
  const showAlert = (each: Alert): void => {
    setState((s) => ({
      ...s,
      page: "map",
      live: true,
      liveDay: each.kind === "record" ? each.date : null,
      liveHour: each.kind === "free" ? hourKey(each.lowest.hour) : null,
    }));
  };
  const [dayData, retryDay] = useAsync(recordDay?.key ?? null, (signal) =>
    loadLiveDay(config.dataBaseUrl, recordDay?.key ?? "", signal),
  );
  const shownLiveData = recordDay ? dayData : liveData;
  const shownLive =
    shownLiveData?.status === "ready" && shownLiveData.value.kind === "ready"
      ? shownLiveData.value.live
      : null;
  // a past day opens at its noon; today opens at the present hour
  const shownNow = (recordDay && shownLive ? noonOf(shownLive, recordDay.date) : null) ?? liveNow;
  const liveIndex = shownLive ? pickHour(shownLive, state.liveHour, shownNow) : 0;
  const liveOverlay = useMemo(
    () => ((state.live || introFlows) && shownLive ? overlay(shownLive, liveIndex) : null),
    [state.live, introFlows, shownLive, liveIndex],
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
  // gas in storage rides on the gas layer; a failure only means the storage bar is not shown
  // the day card wants it too, and asks only once it is opened
  // a monthly report links to the picture of its month: "?pic=2026-10" opens the dialog on it, once
  const [pictureMonth, setPictureMonth] = useState(() => askedPictureMonth(window.location.search));
  // "?pic=gas" opens it on the gas in storage (the learning corner links to it), once as well
  const [gasPicture, setGasPicture] = useState(() => askedGasPicture(window.location.search));
  const [dayCardOpen, setDayCardOpen] = useState(pictureMonth !== null || gasPicture);
  const [storageData] = useAsync(gasOn || dayCardOpen ? GAS_STORAGE_KEY : null, (signal) =>
    loadGasStorage(config.dataBaseUrl, signal),
  );
  const storageShown = storageData?.status === "ready" && storageData.value.kind === "ready";
  const storagePoints = useMemo(
    () =>
      storageData?.status === "ready" && storageData.value.kind === "ready"
        ? storageOverlay(storageData.value.storage)
        : null,
    [storageData],
  );
  // a storage facility clicked on the map; a moment, not a view: not in the URL
  const [storagePick, setStoragePick] = useState<string | null>(null);
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
  // Solar potential: the picture goes to the map, a click on the map to the bar, which reads a value there.
  const solarOn = state.layers.has("solar");
  const {
    data: solarData,
    retry: retrySolar,
    features: solarDoc,
  } = useOverlay(solarOn ? SOLAR_KEY : null, (signal) => loadSolar(config.dataBaseUrl, signal), solarOf);
  // the house under the roof calculator: an extra, so its failure leaves the calculator as it is
  const [homeShapes] = useAsync(solarOn ? HOME_KEY : null, (signal) =>
    loadHomeShapes(config.dataBaseUrl, signal),
  );
  const solarPicture = useMemo(
    () => (solarDoc ? solarImage(solarDoc, config.dataBaseUrl) : null),
    [solarDoc, config.dataBaseUrl],
  );
  // a door on a static page opens the reading, and the house under it, on a place: "?sun=45.81,15.98", once
  const [solarPoint, setSolarPoint] = useState<{ lng: number; lat: number } | null>(() =>
    askedSunPoint(window.location.search),
  );
  // the map needs the release only; the history is the capacity pages'
  const capOn = state.layers.has("capacity");
  const {
    data: capData,
    retry: retryCap,
    features: capFeatures,
  } = useOverlay(
    // the solar bar reads the nearest substation off the same release
    capOn || solarOn ? HEP_KEYS.current : null,
    (signal) => loadHep(config.dataBaseUrl, signal, { history: false }),
    capFeaturesOf,
  );
  const [capStation, setCapStation] = useState<string | null>(null);
  // The bars along the bottom can be folded away together, to see the map (on a phone they take up to
  // half of the screen). Remembered for the bars that were open: opening another one shows them again.
  const openBars = [
    capOn && "capacity",
    solarOn && "solar",
    geoOn && "geothermal",
    storageShown && "gas",
    state.year !== null && "time",
    state.live && "live",
  ]
    .filter(Boolean)
    .join(",");
  const [foldedBars, setFoldedBars] = useState<string | null>(null);
  const barsFolded = openBars !== "" && foldedBars === openBars;
  // a click on the map that a bar answers brings the bars back
  const pickSolarPoint = useCallback(
    (point: { lng: number; lat: number } | null) => {
      setSolarPoint(point);
      setFoldedBars(null);
    },
    [setSolarPoint, setFoldedBars],
  );
  const pickCapStation = useCallback(
    (id: string | null) => {
      setCapStation(id);
      setFoldedBars(null);
    },
    [setCapStation, setFoldedBars],
  );
  const pickStorage = useCallback(
    (id: string) => {
      setStoragePick(id);
      setFoldedBars(null);
    },
    [setStoragePick, setFoldedBars],
  );
  const pickGeoSite = useCallback(
    (id: string | null) => {
      setGeoSite(id);
      setFoldedBars(null);
    },
    [setGeoSite, setFoldedBars],
  );
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
  const onLiveDay = useCallback(
    (day: string | null) => {
      // another day has other hours: the hour in the link belongs to the day it was chosen on
      setState((s) => ({ ...s, liveDay: day, liveHour: null }));
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

  // A guided story (stories/stories.ts): each step sets the layers, lights one kind of thing and moves the
  // map. What the story changes is remembered while no story plays and given back when it ends.
  // a story whose point of light needs a route is played only by a build that has routes
  const asked = state.story ? STORIES[state.story] : null;
  const story = asked && (asked.route === undefined || current.routes !== undefined) ? asked : null;
  const [storyStep, setStoryStep] = useState(0);
  const [storyPlaying, setStoryPlaying] = useState(state.story);
  if (storyPlaying !== state.story) {
    setStoryPlaying(state.story);
    setStoryStep(0);
  }
  const step = story?.steps[storyStep] ?? null;
  const introPlaying = intro.map !== null;
  useEffect(() => {
    // after the intro, which has the map to itself, and once the map can be moved
    if (!step || !mapApi || introPlaying) return;
    setState((s) => applyStep(s, step));
    mapApi.travelTo(step.view.lng, step.view.lat, step.view.zoom, step.tilt);
  }, [step, mapApi, introPlaying, setState]);
  // however the story ended (its button, the cross, Escape, a new link), the map is flat again
  useEffect(() => {
    if (!story && mapApi) mapApi.level();
  }, [story, mapApi]);
  // from the green light: the plants of that country on the map, with what generates the most lit
  const showGenerating = (country: CountryCode, technology: Technology): void => {
    setState((s) => ({
      ...s,
      page: "map",
      layers: new Set([...s.layers, "plants"]),
      countries: new Set([country]),
    }));
    setSpotlight({ kind: "technology", value: technology });
  };
  // The fossil plants behind the hour's carbon footprint: the country's operating plants on those fuels,
  // as a filter the reader can see and undo. Which of them ran in that hour is not known, and not claimed.
  const showFossil = (country: CountryCode, technologies: Technology[]): void => {
    setSpotlight(null);
    setState((s) => ({
      ...s,
      page: "map",
      layers: new Set([...s.layers, "plants"]),
      countries: new Set([country]),
      statuses: new Set(["operating"]),
      technologies: new Set(technologies),
    }));
  };
  // What is on its way towards the 2030 target: the country's wind and solar plants under construction
  // and planned. A filter the reader can see and undo ("Poništi filtre"), not a hidden state.
  const showComing = (country: CountryCode): void => {
    setSpotlight(null);
    setState((s) => ({
      ...s,
      page: "map",
      layers: new Set([...s.layers, "plants"]),
      countries: new Set([country]),
      statuses: new Set(["construction", "planned"]),
      technologies: new Set(["wind", "solar"]),
    }));
  };
  const leaveStory = (): void => {
    setState((s) => leave(s, beforeStory));
    const view = beforeStory.view;
    if (view && mapApi) mapApi.travelTo(view.lng, view.lat, view.zoom);
  };
  // a step's own light, unless the reader is pointing at something in the legend right now
  const shownSpotlight = spotlight ?? step?.spotlight ?? null;

  // The story's point of light (stories/useTravel.ts): its route comes from the data, its position goes
  // straight to the map.
  const routesUrl = story?.route && current.routes ? assetUrl(config.dataBaseUrl, current.routes) : null;
  const [routes] = useAsync(routesUrl, (signal) => loadRoutes(routesUrl ?? "", signal));
  const routeKey = story?.route;
  const route = useMemo(() => {
    const found = routes?.status === "ready" && routeKey ? routes.value.routes[routeKey] : undefined;
    return found ? measure(found.coordinates) : null;
  }, [routes, routeKey]);
  const travel = useTravel(
    mapApi?.showTraveller ?? null,
    route,
    step?.traveller ?? null,
    `${state.story ?? ""}:${storyStep}`,
  );
  const timelinePublished = current.timeline !== undefined;
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
      story: () => {
        setState((s) => ({ ...s, story: "put-struje" }));
      },
      timeMachine: timelinePublished
        ? () => {
            setState((s) => ({ ...s, year: TIME_MACHINE_START, layers: new Set([...s.layers, "plants"]) }));
          }
        : null,
    }),
    [setState, setSheetOpen, current.diff, livePublished, timelinePublished],
  );

  // The grid next to a plant: asked for once a plant is first selected; a failure only means nothing is lit.
  const plantSelected = shownDetails?.kind === "plant";
  const [wantNearby, setWantNearby] = useState(false);
  if (plantSelected && !wantNearby) setWantNearby(true);
  const nearbyUrl = wantNearby && current.nearby ? assetUrl(config.dataBaseUrl, current.nearby) : null;
  const [nearbyData] = useAsync(nearbyUrl, (signal) => loadNearby(nearbyUrl ?? "", signal));
  const selectedId = state.selected;
  const around = useMemo(
    () =>
      plantSelected && selectedId && nearbyData?.status === "ready"
        ? aroundOf(nearbyData.value, selectedId)
        : null,
    [plantSelected, selectedId, nearbyData],
  );

  // Photographs are asked for once, when something is first selected; a failure only means no picture.
  const [wantImages, setWantImages] = useState(false);
  if (state.selected !== null && !wantImages) setWantImages(true);
  const [images] = useAsync(wantImages ? "images/index.json" : null, (signal) =>
    loadImages(config.dataBaseUrl, signal),
  );

  const closeCapacity = useCallback(() => {
    setCapStation(null);
    setState((s) => ({ ...s, layers: new Set([...s.layers].filter((layer) => layer !== "capacity")) }));
  }, [setState, setCapStation]);

  const showStation = useCallback(
    (id: string) => {
      setCapStation(id);
      setState((s) => ({ ...s, layers: new Set([...s.layers, "capacity"]) }));
    },
    [setState, setCapStation],
  );

  const closeSolar = useCallback(() => {
    setSolarPoint(null);
    setState((s) => ({ ...s, layers: new Set([...s.layers].filter((layer) => layer !== "solar")) }));
  }, [setState]);

  const closeGas = useCallback(() => {
    setState((s) => ({ ...s, layers: new Set([...s.layers].filter((layer) => layer !== "gas")) }));
  }, [setState]);

  const closeGeothermal = useCallback(() => {
    setGeoSite(null);
    setState((s) => ({ ...s, layers: new Set([...s.layers].filter((layer) => layer !== "geothermal")) }));
  }, [setState, setGeoSite]);

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
            spotlight={shownSpotlight}
            around={around}
            chargerBands={chargerBands}
            solar={solarPicture}
            {...(solarOn ? { onPoint: pickSolarPoint } : {})}
            maptilerKey={config.maptilerKey}
            live={liveOverlay}
            gas={gasFeatures}
            timeline={timelineFeatures}
            geothermal={geoFeatures}
            capacity={capOn ? capFeatures : null}
            onCapacityStation={pickCapStation}
            gasStorage={gasOn ? storagePoints : null}
            onGasStorage={pickStorage}
            onGeothermalSite={pickGeoSite}
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
              data-folded={sideFolded}
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

          {!state.embed && (
            <button
              type="button"
              className={styles.sideFold}
              data-folded={sideFolded}
              aria-expanded={!sideFolded}
              aria-controls="settings-panel"
              aria-label={t(sideFolded ? "sideUnfold" : "sideFold")}
              title={t(sideFolded ? "sideUnfold" : "sideFold")}
              onClick={() => {
                foldSide(!sideFolded);
              }}
            >
              {sideFolded ? (
                <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
          )}

          {story && !state.selected && (
            <aside className={styles.details}>
              <ErrorBoundary area="story" fallback={panelFallback}>
                <StoryCard
                  story={story}
                  step={storyStep}
                  onStep={setStoryStep}
                  onLeave={leaveStory}
                  travel={travel}
                />
              </ErrorBoundary>
            </aside>
          )}

          {alert && !story && (
            <div className={styles.alert}>
              <ErrorBoundary area="alert" fallback={() => null}>
                <AlertBanner alert={alert} onShow={showAlert} onClose={closeAlert} />
              </ErrorBoundary>
            </div>
          )}

          {welcomeShown && !story && (
            <aside className={`${styles.details} ${styles.welcome}`}>
              <Welcome entries={welcomeEntries} onClose={dismissWelcome} support={config.support} />
            </aside>
          )}

          {state.selected && (
            <aside className={styles.details} aria-label={t("detailsLabel")}>
              <ErrorBoundary area="details" fallback={panelFallback}>
                <DetailsPanel
                  id={state.selected}
                  selection={shownDetails}
                  onClose={closeDetails}
                  around={around}
                  mix={
                    liveDoc && shownDetails?.kind === "charger"
                      ? mixNow(liveDoc, shownDetails.country, liveNow)
                      : null
                  }
                  photo={
                    images?.status === "ready" && images.value.kind === "ready"
                      ? photoOf(images.value.index, config.dataBaseUrl, state.selected)
                      : null
                  }
                />
              </ErrorBoundary>
            </aside>
          )}

          <div className={styles.legend}>
            <Legend
              theme={theme}
              compact={state.selected !== null || state.embed || welcomeShown}
              distribution={state.layers.has("distribution")}
              chargers={state.layers.has("chargers")}
              chargersBanded={chargerBands !== null}
              extraction={state.layers.has("extraction")}
              gas={state.layers.has("gas")}
              cities={state.layers.has("cities")}
              inView={seen}
              onSpotlight={setSpotlight}
            />
          </div>

          <div className={styles.dock} {...(barsFolded ? { "data-folded": "" } : {})}>
            {openBars !== "" && (
              <button
                type="button"
                className={styles.dockFold}
                aria-expanded={!barsFolded}
                onClick={() => {
                  setFoldedBars(barsFolded ? null : openBars);
                }}
              >
                {barsFolded ? (
                  <ChevronUp size={15} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" />
                )}
                {t(barsFolded ? "barsUnfold" : "barsFold")}
              </button>
            )}
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
            {solarOn && (
              <div className={styles.liveSlot}>
                <ErrorBoundary area="solar" fallback={panelFallback}>
                  <SolarBar
                    data={solarData}
                    point={solarPoint}
                    onRetry={retrySolar}
                    onClose={closeSolar}
                    capacity={capData}
                    onStation={showStation}
                    home={homeShapes?.status === "ready" ? homeShapes.value : null}
                  />
                </ErrorBoundary>
              </div>
            )}
            {storageShown && (
              <div className={styles.liveSlot}>
                <ErrorBoundary area="gas storage" fallback={panelFallback}>
                  <GasStorageBar data={storageData} onClose={closeGas} picked={storagePick} />
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
                    onClose={closeGeothermal}
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
                    data={shownLiveData}
                    index={liveIndex}
                    days={recordDays}
                    day={recordDay}
                    onDay={onLiveDay}
                    theme={theme}
                    mapCenter={state.view}
                    onHour={onLiveHour}
                    onRetry={recordDay ? retryDay : retryLive}
                    onClose={closeLive}
                    learnHref={PATHS[i18n.lang].learn}
                  />
                </ErrorBoundary>
              </div>
            )}
            {dayCardOpen && !state.embed && (
              <ErrorBoundary area="day-card" fallback={() => null}>
                <DayCardDialog
                  open
                  onClose={() => {
                    setDayCardOpen(false);
                    setPictureMonth(null);
                    setGasPicture(false);
                  }}
                  month={pictureMonth}
                  {...(gasPicture ? { start: "gas" as const } : {})}
                  storageWaiting={storageData === null || storageData.status === "loading"}
                  live={liveDoc}
                  storage={
                    storageData?.status === "ready" && storageData.value.kind === "ready"
                      ? storageData.value.storage
                      : null
                  }
                  now={liveNow}
                  dataBaseUrl={config.dataBaseUrl}
                />
              </ErrorBoundary>
            )}
            <StatusBar
              current={current}
              dataBaseUrl={config.dataBaseUrl}
              basemap={basemap}
              basemapExpected={config.maptilerKey !== null}
              map={mapApi}
              onDayCard={
                liveDoc && !state.embed
                  ? () => {
                      setDayCardOpen(true);
                    }
                  : undefined
              }
            >
              {liveDoc && !state.embed && (
                <ErrorBoundary area="green" fallback={() => null}>
                  <GreenLight
                    live={liveDoc}
                    now={liveNow}
                    onShow={showGenerating}
                    onShowFossil={showFossil}
                    learnHref={PATHS[i18n.lang].learn}
                    renewables={renewables?.status === "ready" ? renewables.value : null}
                    households={households?.status === "ready" ? households.value : null}
                    usual={usual?.status === "ready" ? usual.value : null}
                    transitionHref={PATHS[i18n.lang].transition}
                    onOpen={askForGoal}
                    onShowComing={showComing}
                  />
                </ErrorBoundary>
              )}
            </StatusBar>
          </div>
        </>
      )}
    </>
  );
}
