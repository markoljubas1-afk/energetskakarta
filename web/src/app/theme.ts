import { useCallback, useEffect, useState } from "react";

import type { Theme } from "../map/palette";

const STORAGE_KEY = "energymap-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // storage can be unavailable (privacy mode); the system theme still applies
  }
}

/**
 * Explicit choice (remembered per browser) wins over the system setting. `override` (the intro's night)
 * is shown for a while without becoming anyone's choice.
 */
export function useTheme(override: Theme | null = null): [Theme, () => void] {
  const [explicit, setExplicit] = useState<Theme | null>(storedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setSystem(query.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  const theme = explicit ?? system;
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
