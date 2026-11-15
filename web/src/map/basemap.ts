/**
 * Basemap selection: MapTiler when a key is configured and reachable, otherwise a self-contained fallback
 * drawn from our own country outlines. Our data layers are merged on top of either.
 */
import type { StyleSpecification } from "maplibre-gl";

import { BOUNDARY_SOURCE, LAYER_PREFIX } from "./layers";
import type { Palette, Theme } from "./palette";

export const MAPTILER_STYLES: Record<Theme, string> = { light: "dataviz", dark: "dataviz-dark" };
export const BASEMAP_TIMEOUT_MS = 6000;

export function maptilerStyleUrl(key: string, theme: Theme): string {
  return `https://api.maptiler.com/maps/${MAPTILER_STYLES[theme]}/style.json?key=${encodeURIComponent(key)}`;
}

export interface Basemap {
  style: StyleSpecification;
  kind: "maptiler" | "fallback";
  /** Font stack for labels, or null when the style has no glyphs. */
  fonts: string[] | null;
}

function isStyle(value: unknown): value is StyleSpecification {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StyleSpecification>;
  return candidate.version === 8 && Array.isArray(candidate.layers) && typeof candidate.sources === "object";
}

/** Pick a font the basemap already uses for labels, so our labels need no extra glyph requests. */
export function labelFonts(style: StyleSpecification): string[] | null {
  if (!style.glyphs) return null;
  for (const layer of style.layers) {
    if (layer.type !== "symbol") continue;
    const font = layer.layout?.["text-font"];
    if (Array.isArray(font) && font.length > 0 && font.every((f) => typeof f === "string")) {
      return font as string[];
    }
  }
  return null;
}

export function fallbackStyle(palette: Palette): StyleSpecification {
  return {
    version: 8,
    name: "energymap-fallback",
    sources: {},
    layers: [
      { id: "fallback-sea", type: "background", paint: { "background-color": palette.sea } },
      {
        id: `${LAYER_PREFIX}fallback-land`,
        type: "fill",
        source: BOUNDARY_SOURCE,
        "source-layer": "countries",
        paint: {
          "fill-color": ["case", ["get", "inScope"], palette.land, palette.landOutside],
        },
      },
      {
        id: `${LAYER_PREFIX}fallback-borders`,
        type: "line",
        source: BOUNDARY_SOURCE,
        "source-layer": "countries",
        paint: { "line-color": palette.border, "line-width": 0.6, "line-opacity": 0.7 },
      },
    ],
  };
}

export async function loadBasemap(
  key: string | null,
  theme: Theme,
  palette: Palette,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = BASEMAP_TIMEOUT_MS,
): Promise<Basemap> {
  const fallback: Basemap = { style: fallbackStyle(palette), kind: "fallback", fonts: null };
  if (!key) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(maptilerStyleUrl(key, theme), { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[basemap] MapTiler returned HTTP ${response.status}; using fallback basemap`);
      return fallback;
    }
    const body: unknown = await response.json();
    if (!isStyle(body)) {
      console.warn("[basemap] MapTiler style has an unexpected shape; using fallback basemap");
      return fallback;
    }
    return { style: body, kind: "maptiler", fonts: labelFonts(body) };
  } catch (error) {
    console.warn("[basemap] MapTiler unavailable; using fallback basemap", error);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Put our sources and layers on top of the basemap. Fallback land/border layers need our boundary
 * source, so sources are always merged first.
 */
export function composeStyle(
  basemap: StyleSpecification,
  sources: StyleSpecification["sources"],
  layers: StyleSpecification["layers"],
  reducedMotion = false,
): StyleSpecification {
  const clash = layers.find((layer) => basemap.layers.some((existing) => existing.id === layer.id));
  if (clash) throw new Error(`Layer id collision with basemap: ${clash.id}`);
  return {
    ...basemap,
    sources: { ...basemap.sources, ...sources },
    layers: [...basemap.layers, ...layers],
    // paint changes (price colours between hours, the time machine's year) fade unless motion is reduced
    transition: reducedMotion ? { duration: 0, delay: 0 } : { duration: 400, delay: 0 },
  };
}
