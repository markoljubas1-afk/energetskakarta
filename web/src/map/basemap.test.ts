import { afterEach, describe, expect, it, vi } from "vitest";

import { composeStyle, labelFonts, loadBasemap, maptilerStyleUrl, trimBasemap } from "./basemap";
import { PALETTES } from "./palette";

const palette = PALETTES.light;
const maptilerStyle = {
  version: 8,
  glyphs: "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=k",
  sources: { maptiler: { type: "vector", url: "https://api.maptiler.com/tiles/v3/tiles.json?key=k" } },
  layers: [
    { id: "place", type: "symbol", source: "maptiler", layout: { "text-font": ["Noto Sans Regular"] } },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadBasemap", () => {
  it("uses the fallback without a key, without any request", async () => {
    const fetchImpl = vi.fn();
    const basemap = await loadBasemap(null, "light", palette, fetchImpl);
    expect(basemap.kind).toBe("fallback");
    expect(basemap.fonts).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("loads MapTiler's dark style for the dark theme", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(maptilerStyle)));
    const basemap = await loadBasemap("k&y", "dark", palette, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.maptiler.com/maps/dataviz-dark/style.json?key=k%26y",
      expect.objectContaining({ signal: expect.any(AbortSignal) as unknown }),
    );
    expect(basemap).toMatchObject({ kind: "maptiler", fonts: ["Noto Sans Regular"] });
  });

  it.each([
    ["quota exceeded", () => Promise.resolve(new Response("limit", { status: 403 }))],
    ["unexpected body", () => Promise.resolve(new Response('{"error":"x"}'))],
    ["network failure", () => Promise.reject(new TypeError("offline"))],
  ])("falls back when MapTiler fails: %s", async (_, impl) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const basemap = await loadBasemap("k", "light", palette, vi.fn(impl));
    expect(basemap.kind).toBe("fallback");
  });

  it("falls back when MapTiler does not answer in time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hang = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const basemap = await loadBasemap("k", "light", palette, hang, 10);
    expect(basemap.kind).toBe("fallback");
  });
});

describe("maptilerStyleUrl", () => {
  it("uses the Dataviz styles", () => {
    expect(maptilerStyleUrl("k", "light")).toBe("https://api.maptiler.com/maps/dataviz/style.json?key=k");
  });
});

describe("a lighter basemap for phones (Faza 50)", () => {
  // the shape of MapTiler's dataviz styles: a sheet of icons no layer draws, the seas in italic
  const dataviz = {
    version: 8 as const,
    sprite: "https://api.maptiler.com/sprites/general/sprite",
    glyphs: "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=k",
    sources: {},
    layers: [
      { id: "bg", type: "background" as const, paint: { "background-color": "#000" } },
      {
        id: "Ocean labels",
        type: "symbol" as const,
        source: "maptiler",
        layout: { "text-font": ["Metropolis Semi Bold Italic", "Noto Sans Bold"] },
      },
      {
        id: "City labels",
        type: "symbol" as const,
        source: "maptiler",
        layout: { "text-font": ["Metropolis Semi Bold", "Noto Sans Bold"] },
      },
    ],
  };

  it("sets the seas upright and gives our labels the upright face", () => {
    const trimmed = trimBasemap(dataviz);
    const fonts = trimmed.layers.flatMap((layer) =>
      layer.type === "symbol" ? [JSON.stringify(layer.layout?.["text-font"])] : [],
    );
    expect(new Set(fonts)).toEqual(new Set([JSON.stringify(["Metropolis Semi Bold", "Noto Sans Bold"])]));
    // our labels used to take the first label's face, the sea's italic
    expect(labelFonts(dataviz)).toEqual(["Metropolis Semi Bold", "Noto Sans Bold"]);
    expect(labelFonts(trimmed)).toEqual(["Metropolis Semi Bold", "Noto Sans Bold"]);
  });

  it("leaves a style with only italic labels as it is", () => {
    const onlyItalic = { ...dataviz, layers: dataviz.layers.slice(0, 2) };
    expect(trimBasemap(onlyItalic)).toBe(onlyItalic);
  });

  it("drops the sheet of icons when nothing draws from it, and keeps it when something does", () => {
    expect(composeStyle(dataviz, {}, []).sprite).toBeUndefined();
    const icon = {
      id: "energymap-icon",
      type: "symbol" as const,
      source: "maptiler",
      layout: { "icon-image": "star" },
    };
    expect(composeStyle(dataviz, {}, [icon]).sprite).toBe(dataviz.sprite);
    expect(composeStyle({ ...dataviz, layers: [...dataviz.layers, icon] }, {}, []).sprite).toBe(
      dataviz.sprite,
    );
  });

  it("is what loadBasemap hands over", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(dataviz)));
    const basemap = await loadBasemap("k", "dark", palette, fetchImpl);
    expect(basemap.fonts).toEqual(["Metropolis Semi Bold", "Noto Sans Bold"]);
    expect(JSON.stringify(basemap.style)).not.toContain("Italic");
  });
});
