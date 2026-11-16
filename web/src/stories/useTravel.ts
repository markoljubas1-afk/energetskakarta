import { useCallback, useEffect, useRef, useState } from "react";

import { eased, travellerAt, TRAVEL_MS, type Measured, type Traveller } from "./travel";

export interface TravelControls {
  /** the reader wants it moving (it may still be standing because it has arrived) */
  playing: boolean;
  /** it has reached the end of the route */
  arrived: boolean;
  toggle: () => void;
  replay: () => void;
  /** names this run of the journey: a new one (another step, a replay) starts the progress bar again */
  journey: string;
}

const reducedMotion = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Moves a story's point of light (Faza 35-3). `show` puts it on the map; `mode` says what the current step
 * wants: the light waiting at the start, travelling the whole route, or arrived; null takes it off. `step`
 * names the step, so the journey starts again when the reader comes back to it.
 *
 * The position lives in a ref and goes straight to the map on every animation frame: React hears only
 * about arriving. A reader who asked their system for less motion sees the whole route at once.
 */
export function useTravel(
  show: ((traveller: Traveller | null) => void) | null,
  route: Measured | null,
  mode: "start" | "travel" | "end" | null,
  step: string,
): TravelControls | null {
  const [playing, setPlaying] = useState(true);
  const [run, setRun] = useState(0);
  const [arrivedIn, setArrivedIn] = useState<string | null>(null);
  const progress = useRef(0);
  const shownJourney = useRef<string | null>(null);
  const journey = `${step}#${run}`;
  useEffect(() => {
    if (!show) return;
    if (!route || mode === null) {
      show(null);
      return;
    }
    if (mode !== "travel") {
      show(travellerAt(route, mode === "start" ? 0 : 1));
      return;
    }
    if (shownJourney.current !== journey) {
      shownJourney.current = journey;
      progress.current = 0;
    }
    if (reducedMotion()) progress.current = 1;
    show(travellerAt(route, eased(progress.current)));
    if (!playing || progress.current >= 1) return;
    let frame = 0;
    let before: number | null = null;
    const tick = (now: number): void => {
      if (before !== null) progress.current = Math.min(1, progress.current + (now - before) / TRAVEL_MS);
      before = now;
      show(travellerAt(route, eased(progress.current)));
      if (progress.current >= 1) {
        setArrivedIn(journey);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [show, route, mode, playing, journey]);

  const toggle = useCallback(() => {
    setPlaying((value) => !value);
  }, []);
  const replay = useCallback(() => {
    setRun((value) => value + 1);
    setPlaying(true);
  }, []);

  if (mode !== "travel" || !route) return null;
  return { playing, arrived: arrivedIn === journey, toggle, replay, journey };
}
