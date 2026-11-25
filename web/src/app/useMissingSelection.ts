/**
 * A link can select an object that is not in the map tiles loaded so far: elsewhere in the region, or with no
 * view in the link. The map reports that after it settles; this finds where the object is (the search index),
 * flies there once, and gives up with a clear "not found" instead of loading forever (Faza 56, 4.4a).
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface Place {
  lon: number;
  lat: number;
}

/** looking: the index is being read; flown: the map was sent there; notFound: nothing more to try */
type Phase = "looking" | "flown" | "notFound";

export function useMissingSelection(
  selected: string | null,
  locate: (id: string) => Promise<Place | null>,
  flyTo: ((lon: number, lat: number) => void) | null,
): { notFound: boolean; onMissing: (id: string) => void } {
  const [phase, setPhase] = useState<{ id: string; phase: Phase } | null>(null);
  // the map calls back from its own handlers: they read the latest values through refs
  const latest = useRef({ selected, locate, flyTo, phase });
  useLayoutEffect(() => {
    latest.current = { selected, locate, flyTo, phase };
  });

  const onMissing = useCallback((id: string) => {
    const now = latest.current;
    if (id !== now.selected) return;
    const current = now.phase?.id === id ? now.phase.phase : null;
    if (current === "looking" || current === "notFound") return;
    if (current === "flown") {
      // arrived and settled, and the object is still not there
      setPhase({ id, phase: "notFound" });
      return;
    }
    const looking = { id, phase: "looking" as const };
    latest.current = { ...now, phase: looking };
    setPhase(looking);
    now
      .locate(id)
      .then((place) => {
        const { selected: still, flyTo: fly } = latest.current;
        if (still !== id) return;
        if (place && fly) {
          setPhase({ id, phase: "flown" });
          fly(place.lon, place.lat);
        } else {
          setPhase({ id, phase: "notFound" });
        }
      })
      .catch((error: unknown) => {
        console.error("[selection] could not look up where the linked object is", id, error);
        if (latest.current.selected === id) setPhase({ id, phase: "notFound" });
      });
  }, []);

  return { notFound: phase?.id === selected && phase.phase === "notFound", onMissing };
}
