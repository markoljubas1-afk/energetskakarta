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

/** A font stack as a list of names, or null for an expression. */
function fontStack(layer: StyleSpecification["layers"][number]): string[] | null {
  if (layer.type !== "symbol") return null;
  const font = layer.layout?.["text-font"];
  return Array.isArray(font) && font.length > 0 && font.every((f) => typeof f === "string")
    ? (font as string[])
    : null;
}

const italic = (stack: readonly string[]): boolean => stack.some((name) => /italic/i.test(name));

/**
 * The basemap made lighter for phones (Faza 50). MapTiler's dataviz styles name an icon sheet (`sprite`,
 * 340 kB at 2×) that none of their layers draw, and set the names of seas and lakes in an italic face that
 * nothing else uses: the sheet is dropped and the italic names take the upright face of the place names,
 * whose glyphs are fetched anyway. A style that does draw icons keeps its sheet (`composeStyle` checks ours too).
 */
export function trimBasemap(style: StyleSpecification): StyleSpecification {
  const upright = style.layers.map(fontStack).find((stack) => stack !== null && !italic(stack)) ?? null;
  if (!upright) return style;
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const stack = fontStack(layer);
      if (layer.type !== "symbol" || stack === null || !italic(stack)) return layer;
      return { ...layer, layout: { ...layer.layout, "text-font": upright } };
    }),
  };
}

/** Whether any layer draws from the icon sheet. */
export function drawsIcons(layers: StyleSpecification["layers"]): boolean {
  return layers.some((layer) => {
    const layout = layer.layout as Record<string, unknown> | undefined;
    const paint = layer.paint as Record<string, unknown> | undefined;
    return (
      layout?.["icon-image"] !== undefined ||
      paint?.["fill-pattern"] !== undefined ||
      paint?.["line-pattern"] !== undefined ||
      paint?.["background-pattern"] !== undefined ||
      paint?.["fill-extrusion-pattern"] !== undefined
    );
  });
}

/**
 * Pick a font the basemap already uses for labels, so our labels need no extra glyph requests: an upright one,
 * since the first label of the style is usually the sea's italic (before Faza 50 our labels were set in it).
 */
export function labelFonts(style: StyleSpecification): string[] | null {
  if (!style.glyphs) return null;
  const stacks = style.layers.map(fontStack).filter((stack): stack is string[] => stack !== null);
  return stacks.find((stack) => !italic(stack)) ?? stacks[0] ?? null;
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
    const style = trimBasemap(body);
    return { style, kind: "maptiler", fonts: labelFonts(style) };
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
  const all = [...basemap.layers, ...layers];
  // an icon sheet nothing draws from is a download for nothing (Faza 50)
  const { sprite, ...rest } = basemap;
  return {
    ...(drawsIcons(all) && sprite !== undefined ? { ...rest, sprite } : rest),
    sources: { ...basemap.sources, ...sources },
    layers: all,
    // paint changes (price colours between hours, the time machine's year) fade unless motion is reduced
    transition: reducedMotion ? { duration: 0, delay: 0 } : { duration: 400, delay: 0 },
  };
}
