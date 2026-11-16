import { useCallback, useEffect, useState } from "react";

import type { Theme } from "../map/palette";

const STORAGE_KEY = "energymap-theme";
/**
 * The map opens at night (decision 2026-11-16): lines and plants that glow on a dark ground are the look
 * people remember, and the first visit decides whether they stay. The reader's own choice still wins and
 * is remembered; the system's light or dark setting is no longer consulted for the map.
 */
export const DEFAULT_THEME: Theme = "dark";

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // storage can be unavailable (privacy mode); the default still applies
  }
}

/**
 * Explicit choice (remembered per browser) wins over the default. `override` (the intro's night) is shown
 * for a while without becoming anyone's choice.
 */
export function useTheme(override: Theme | null = null): [Theme, () => void] {
  const [explicit, setExplicit] = useState<Theme | null>(storedTheme);
  const theme = explicit ?? DEFAULT_THEME;
  const shown = override ?? theme;

  useEffect(() => {
    document.documentElement.dataset.theme = shown;
  }, [shown]);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setExplicit(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not persisted; the choice still applies for this visit
    }
  }, [theme]);

  return [shown, toggle];
}
