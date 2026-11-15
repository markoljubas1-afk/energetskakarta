import { afterEach, describe, expect, it, vi } from "vitest";

import { loadBasemap, maptilerStyleUrl } from "./basemap";
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
