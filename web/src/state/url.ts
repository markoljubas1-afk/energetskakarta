/**
 * The URL is the single source of truth for what the map shows, so every view can be shared as a link.
 * Defaults are omitted from the URL to keep links short.
 */
import { STORY_KEYS, type StoryKey } from "../stories/keys";
import { useCallback, useSyncExternalStore } from "react";

import {
  ASSET_ID,
  DEFAULT_LAYER_KEYS,
  isOneOf,
  LAYER_KEYS,
  SCOPE_COUNTRIES,
  STATUSES,
  TECHNOLOGIES,
  VOLTAGE_CLASSES,
  type CountryCode,
  type LayerKey,
  type Status,
  type Technology,
  type VoltageClass,
} from "../domain";

export const LANGS = ["hr", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const PANELS = ["filters", "overview", "changes"] as const;
export type Panel = (typeof PANELS)[number];
export const PAGES = ["map", "energy"] as const;
export type Page = (typeof PAGES)[number];
export const ENERGY_UNITS = ["month", "year"] as const;
export type EnergyUnit = (typeof ENERGY_UNITS)[number];
export const ENERGY_SHOWS = ["chart", "table"] as const;
export type EnergyShow = (typeof ENERGY_SHOWS)[number];
export const ENERGY_AREAS = ["ALL", ...SCOPE_COUNTRIES] as const;
/** The energy page's cards, by the id their links open at; with `embed` one of them is shown alone (Faza 23-5). */
export const ENERGY_CHARTS = ["mix", "ring", "compare", "range"] as const;
export type EnergyChart = (typeof ENERGY_CHARTS)[number];
export type EnergyArea = (typeof ENERGY_AREAS)[number];

export interface EnergyState {
  area: EnergyArea;
  unit: EnergyUnit;
  /** technology compared across years */
  tech: Technology;
  /** inclusive ISO dates */
  range: { from: string; to: string } | null;
  show: EnergyShow;
  /** the one card an embedded page shows; null shows them all */
  chart: EnergyChart | null;
}

export interface View {
  lng: number;
  lat: number;
  zoom: number;
}

export interface AppState {
  view: View | null;
  layers: ReadonlySet<LayerKey>;
  statuses: ReadonlySet<Status>;
  technologies: ReadonlySet<Technology>;
  voltages: ReadonlySet<VoltageClass>;
  minMw: number;
  /** Empty means every country. */
  countries: ReadonlySet<CountryCode>;
  selected: string | null;
  lang: Lang;
  panel: Panel;
  page: Page;
  energy: EnergyState;
  /** live flows and prices layer */
  live: boolean;
  /** "2026-09-16T13+02" (older links: without the offset); null = the current hour */
  liveHour: string | null;
  /** a record day shown in the live layer instead of today (data/live.ts); null: today */
  liveDay: string | null;
  /** inside someone else's page: only the map, with a link back to the full site */
  embed: boolean;
  /** time machine: plants in operation in this year (Faza 18-3); null = off, the map shows today */
  year: number | null;
  /** a guided story is playing (stories/stories.ts); its step is not part of the address */
  story: StoryKey | null;
}

export const DEFAULT_VIEW: View = { lng: 16.2, lat: 44.6, zoom: 5.2 };

export function defaultState(lang: Lang): AppState {
  return {
    view: null,
    layers: new Set(DEFAULT_LAYER_KEYS),
    statuses: new Set(STATUSES),
    technologies: new Set(TECHNOLOGIES),
    voltages: new Set(VOLTAGE_CLASSES),
    minMw: 0,
    countries: new Set(),
    selected: null,
    lang,
    panel: "filters",
    page: "map",
    energy: { area: "ALL", unit: "month", tech: "solar", range: null, show: "chart", chart: null },
    live: false,
    liveHour: null,
    liveDay: null,
    embed: false,
    year: null,
    story: null,
  };
}

/** Years the time machine accepts in a link: the first public power stations to the end of the century. */
export const YEAR_RANGE = [1880, 2100] as const;
/** Where the time machine starts when it is offered as a first door: far enough back for the map to look different. */
export const TIME_MACHINE_START = 1960;

function parseYear(raw: string | null): number | null {
  if (raw === null || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= YEAR_RANGE[0] && year <= YEAR_RANGE[1] ? year : null;
}

const MIN_MW_STEPS = [0, 1, 10, 50, 100, 500] as const;

function parseSet<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: ReadonlySet<T>,
): Set<T> {
  if (raw === null) return new Set(fallback);
  if (raw === "") return new Set();
  return new Set(raw.split(",").filter((value): value is T => isOneOf(allowed, value)));
}

function parseView(raw: string | null): View | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  const [lat, lng, zoom] = parts;
  if (parts.length !== 3 || lat === undefined || lng === undefined || zoom === undefined) return null;
  if (!parts.every(Number.isFinite)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lng) > 180 || zoom < 0 || zoom > 22) return null;
  return { lat, lng, zoom };
}

/**
 * The place a link asks the solar layer to read ("?sun=45.8150,15.9819"), as a static page's door to the
 * house under the roof calculator writes it. A clicked place is a moment, not a view: it is read once when
 * the page opens and never written back to the address.
 */
export function askedSunPoint(search: string): { lng: number; lat: number } | null {
  const raw = new URLSearchParams(search).get("sun");
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  const [lat, lng] = parts;
  if (parts.length !== 2 || lat === undefined || lng === undefined) return null;
  if (!parts.every(Number.isFinite) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  return { lng, lat };
}

export function parseState(search: string, fallbackLang: Lang): AppState {
  const params = new URLSearchParams(search);
  const defaults = defaultState(fallbackLang);
  const minMw = Number(params.get("mw"));
  const selected = params.get("sel");
  const lang = params.get("lang");
  const panel = params.get("panel");
  return {
    view: parseView(params.get("v")),
    layers: parseSet(params.get("l"), LAYER_KEYS, defaults.layers),
    statuses: parseSet(params.get("s"), STATUSES, defaults.statuses),
    technologies: parseSet(params.get("t"), TECHNOLOGIES, defaults.technologies),
    voltages: parseSet(params.get("kv"), VOLTAGE_CLASSES, defaults.voltages),
    minMw: (MIN_MW_STEPS as readonly number[]).includes(minMw) ? minMw : 0,
    countries: parseSet(params.get("c"), SCOPE_COUNTRIES, defaults.countries),
    selected: selected && ASSET_ID.test(selected) ? selected : null,
    lang: isOneOf(LANGS, lang) ? lang : fallbackLang,
    panel: isOneOf(PANELS, panel) ? panel : "filters",
    page: pick(PAGES, params.get("p"), defaults.page),
    live: params.get("live") === "1",
    liveHour: /^\d{4}-\d{2}-\d{2}T\d{2}([+-]\d{2})?$/.test(params.get("lt") ?? "") ? params.get("lt") : null,
    liveDay: /^\d{4}-\d{2}-\d{2}$/.test(params.get("ld") ?? "") ? params.get("ld") : null,
    embed: params.get("embed") === "1",
    year: parseYear(params.get("y")),
    story: STORY_KEYS.find((key) => key === params.get("story")) ?? null,
    energy: {
      area: pick(ENERGY_AREAS, params.get("ea"), defaults.energy.area),
      unit: pick(ENERGY_UNITS, params.get("eu"), defaults.energy.unit),
      tech: pick(TECHNOLOGIES, params.get("et"), defaults.energy.tech),
      range: parseRange(params.get("er")),
      show: pick(ENERGY_SHOWS, params.get("es"), defaults.energy.show),
      chart: pickOrNull(ENERGY_CHARTS, params.get("ec")),
    },
  };
}

/** A known value, or null when the parameter is missing or unknown. */
function pickOrNull<T extends string>(allowed: readonly T[], raw: string | null): T | null {
  return allowed.find((value) => value === raw) ?? null;
}

function pick<T extends string>(allowed: readonly T[], raw: string | null, fallback: T): T {
  return isOneOf(allowed, raw) ? raw : fallback;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(raw: string | null): EnergyState["range"] {
  const [from, to, ...rest] = (raw ?? "").split(",");
  if (!from || !to || rest.length > 0 || !DATE.test(from) || !DATE.test(to) || from > to) return null;
  return { from, to };
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

/** Serialise in a fixed key order; values follow the canonical order of their vocabulary. */
export function serializeState(state: AppState, fallbackLang: Lang): string {
  const defaults = defaultState(fallbackLang);
  const params = new URLSearchParams();
  if (state.view) {
    const { lat, lng, zoom } = state.view;
    params.set("v", `${lat.toFixed(4)},${lng.toFixed(4)},${zoom.toFixed(2)}`);
  }
  const sets: [string, ReadonlySet<string>, ReadonlySet<string>, readonly string[]][] = [
    ["l", state.layers, defaults.layers, LAYER_KEYS],
    ["s", state.statuses, defaults.statuses, STATUSES],
    ["t", state.technologies, defaults.technologies, TECHNOLOGIES],
    ["kv", state.voltages, defaults.voltages, VOLTAGE_CLASSES],
    ["c", state.countries, defaults.countries, SCOPE_COUNTRIES],
  ];
  for (const [key, value, fallback, order] of sets) {
    if (!sameSet(value, fallback)) params.set(key, order.filter((item) => value.has(item)).join(","));
  }
  if (state.minMw !== 0) params.set("mw", String(state.minMw));
  if (state.selected) params.set("sel", state.selected);
  if (state.lang !== fallbackLang) params.set("lang", state.lang);
  if (state.panel !== defaults.panel) params.set("panel", state.panel);
  if (state.page !== defaults.page) params.set("p", state.page);
  if (state.live) params.set("live", "1");
  if (state.live && state.liveHour) params.set("lt", state.liveHour);
  if (state.live && state.liveDay) params.set("ld", state.liveDay);
  if (state.embed) params.set("embed", "1");
  if (state.year !== null) params.set("y", String(state.year));
  if (state.story) params.set("story", state.story);
  const energy = state.energy;
  if (energy.area !== defaults.energy.area) params.set("ea", energy.area);
  if (energy.unit !== defaults.energy.unit) params.set("eu", energy.unit);
  if (energy.tech !== defaults.energy.tech) params.set("et", energy.tech);
  if (energy.range) params.set("er", `${energy.range.from},${energy.range.to}`);
  if (energy.show !== defaults.energy.show) params.set("es", energy.show);
  if (energy.chart) params.set("ec", energy.chart);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * The language of the page is its path (decision 2026-11-08, todo 16-A3): "/" is Croatian and "/en/" English,
 * so search engines index two pages with one language each. The `lang` query parameter of older links still
 * parses, and `canonicalUrl` moves it into the path.
 */
export function langFromPath(pathname: string): Lang {
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : "hr";
}

export function pathForLang(lang: Lang): string {
  return lang === "en" ? "/en/" : "/";
}

/** The address an old `?lang=…` link should have, or null when it is already canonical. */
export function canonicalUrl(pathname: string, search: string): string | null {
  if (!new URLSearchParams(search).has("lang")) return null;
  const state = parseState(search, langFromPath(pathname));
  return `${pathForLang(state.lang)}${serializeState(state, state.lang)}`;
}

/** The reader's preferred language from the browser; no longer chooses the page, which the path does. */
export function browserLang(languages: readonly string[]): Lang {
  const first = languages[0]?.toLowerCase() ?? "";
  return /^(hr|bs|sr|sh|sl)\b/.test(first) || first === "" ? "hr" : "en";
}

export { MIN_MW_STEPS };

// ---------------------------------------------------------------- React binding

const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}
const getLocation = (): string => `${window.location.pathname}${window.location.search}`;

// Parsed state is memoised per address (path carries the language, query the rest) so React sees a stable
// object between renders.
let cache: { key: string; state: AppState } | null = null;
function stateFor(location: string): AppState {
  if (cache?.key !== location) {
    const url = new URL(location, "http://localhost");
    cache = { key: location, state: parseState(url.search, langFromPath(url.pathname)) };
  }
  return cache.state;
}

export function useUrlState(): [AppState, (update: (state: AppState) => AppState) => void] {
  const location = useSyncExternalStore(subscribe, getLocation, () => "/");
  const state = stateFor(location);
  const setState = useCallback((update: (state: AppState) => AppState) => {
    const { pathname, search, hash } = window.location;
    const next = update(parseState(search, langFromPath(pathname)));
    // the language lives in the path, so switching it moves between / and /en/
    const nextPath = pathForLang(next.lang);
    const nextSearch = serializeState(next, next.lang);
    if (nextPath === pathname && nextSearch === search) return;
    // replaceState: panning must not flood the back button with history entries
    window.history.replaceState(null, "", `${nextPath}${nextSearch}${hash}`);
    listeners.forEach((listener) => listener());
  }, []);
  return [state, setState];
}
