/**
 * The intro's controller (Faza 22). Decides once, on the first render, whether there is an intro, then
 * moves through its phases from facts that arrive on their own (the title's minimum time, the map's first
 * frame, the camera's arrival, a skip, giving up) rather than from effects that set state:
 *
 *   title    the overlay with the title covers the page while the data and the map load
 *   play     the map flies in and the grid lights up under the title
 *   handoff  the overlay fades, the panels come back, a light theme dawns
 *   done     the ordinary page
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Theme } from "../map/palette";
import type { Lang } from "../state/url";
import { INTRO_STORAGE_KEY, INTRO_TIMING, introMode, type IntroMode } from "./introMode";

export type IntroPhase = "title" | "play" | "handoff" | "done";

function seenBefore(): boolean {
  try {
    return window.localStorage.getItem(INTRO_STORAGE_KEY) !== null;
  } catch {
    return false; // storage unavailable (privacy mode): the intro may play again, which is harmless
  }
}

function rememberSeen(): void {
  try {
    window.localStorage.setItem(INTRO_STORAGE_KEY, "1");
  } catch {
    // not remembered; the next visit plays it again
  }
}

export interface IntroControl {
  mode: IntroMode;
  phase: IntroPhase;
  /** what the map does: wait on the globe, fly in, or nothing */
  map: "hold" | "play" | null;
  /** the theme the page shows while the intro is at night, or null for the reader's own */
  theme: Theme | null;
  skip: () => void;
  onMapReady: () => void;
  onMapDone: () => void;
}

/** `failed`: the page's data did not load; the error must not wait behind the intro. */
export function useIntro(lang: Lang, failed: boolean): IntroControl {
  const [mode] = useState<IntroMode>(() =>
    introMode({
      search: window.location.search,
      lang,
      seen: seenBefore(),
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      automated: navigator.webdriver,
    }),
  );
  const [titleDone, setTitleDone] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapReadyRef = useRef(false);
  const [arrived, setArrived] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [finished, setFinished] = useState(false);

  const phase: IntroPhase =
    mode === "none" || finished || failed
      ? "done"
      : skipped || gaveUp || arrived || (mode === "still" && titleDone)
        ? "handoff"
        : mode === "full" && titleDone && mapReady
          ? "play"
          : "title";

  useEffect(() => {
    if (mode === "none") return;
    const title = window.setTimeout(() => {
      setTitleDone(true);
    }, INTRO_TIMING.titleMs);
    // a slow connection gets the page as it always was, not a title that never ends
    const giveUp = window.setTimeout(() => {
      if (!mapReadyRef.current) setGaveUp(true);
    }, INTRO_TIMING.giveUpMs);
    return () => {
      window.clearTimeout(title);
      window.clearTimeout(giveUp);
    };
  }, [mode]);

  useEffect(() => {
    if (phase !== "handoff") return;
    rememberSeen();
    const timer = window.setTimeout(() => {
      setFinished(true);
    }, INTRO_TIMING.handoffMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

  const skip = useCallback(() => {
    setSkipped(true);
  }, []);
  const onMapReady = useCallback(() => {
    mapReadyRef.current = true;
    setMapReady(true);
  }, []);
  const onMapDone = useCallback(() => {
    setArrived(true);
  }, []);

  const map: IntroControl["map"] =
    mode !== "full"
      ? null
      : phase === "title"
        ? "hold"
        : phase === "play" || (phase === "handoff" && arrived)
          ? "play" // after a natural arrival the map settles while the overlay fades
          : null; // skipped or given up: straight to the ordinary map
  const night = mode === "full" && (phase === "title" || phase === "play");
  return { mode, phase, map, theme: night ? "dark" : null, skip, onMapReady, onMapDone };
}
