import { useEffect, useState } from "react";

/** Milliseconds until the next full hour on the visitor's clock. */
export function msToNextHour(now: Date): number {
  const next = new Date(now.getTime());
  next.setMinutes(60, 0, 0); // rolls over into the next hour (and day)
  return next.getTime() - now.getTime();
}

/**
 * The current time, refreshed just after every full hour and when the visitor returns to the tab, so a map
 * left open follows the current hour of the live layer (Faza 18-1). Idle while `enabled` is false.
 */
export function useHourClock(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    let timer = window.setTimeout(function tick() {
      setNow(new Date());
      timer = window.setTimeout(tick, msToNextHour(new Date()) + 1_000);
    }, 0); // turning the layer on picks up the time at once, not the time the page was opened
    const onVisible = (): void => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  return now;
}
