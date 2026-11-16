/**
 * The first-visit intro (Faza 22): whether it plays and how long its parts last. Pure functions for the
 * overlay (Intro.tsx) and its controller (useIntro.ts); the map's part is in map/introFlight.ts and
 * map/introStyle.ts.
 */
import { parseState, serializeState, type Lang } from "../state/url";

/** `full`: title, flight and the grid lighting up; `still`: the title fades into the map; `none`: no intro. */
export type IntroMode = "full" | "still" | "none";

/** Remembered per browser once the intro has been seen or skipped. */
export const INTRO_STORAGE_KEY = "energymap-intro";

export interface IntroEnvironment {
  search: string;
  lang: Lang;
  /** this browser has seen the intro before */
  seen: boolean;
  reducedMotion: boolean;
  /** a browser driven by automation (tests, crawlers' renderers): they get the map at once */
  automated: boolean;
}

/**
 * Whether a link points at something: any map state (a selection, a view, layers, filters, the live layer,
 * embedding…). Parameters the map does not know, such as `utm_source`, do not count.
 */
export function linksSomewhere(search: string, lang: Lang): boolean {
  return serializeState(parseState(search, lang), lang) !== "";
}

/** A shared link opens on what it shares, and a returning visitor goes straight to the map. */
export function introMode(env: IntroEnvironment): IntroMode {
  if (env.automated || env.seen || linksSomewhere(env.search, env.lang)) return "none";
  return env.reducedMotion ? "still" : "full";
}

/**
 * The whole intro lasts about two seconds on a wide screen (decision 2026-11-16; it was close to eight):
 * title 450 ms, flight 1200 ms (introFlight.ts), a moment to settle, hand-off 350 ms. Long enough to be a
 * scene, short enough that nobody waits for the map.
 */
export const INTRO_TIMING = {
  /** the title is on its own at least this long before the flight begins */
  titleMs: 450,
  /** the intro stops waiting for the map after this; the page then loads as it always has */
  giveUpMs: 5000,
  /** the overlay fades and the panels come back, while the map settles (INTRO_TRANSITION_MS) */
  handoffMs: 350,
  /** still mode: how long the title stays once the map is there */
  stillMs: 600,
} as const;
