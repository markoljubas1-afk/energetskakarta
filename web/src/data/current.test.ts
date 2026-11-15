import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { assetUrl, CurrentSchema, DataError, fetchJson, loadCurrent } from "./current";

const base = new URL("https://podaci.test/root/");

export const CURRENT_FIXTURE = {
  buildId: "20260916T120000Z",
  createdAt: "2026-09-16T12:00:00+00:00",
  counts: { lines: 4, substations: 2, plants: 5 },
  attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0",
  tiles: {
    grid: {
      url: "builds/20260916T120000Z/grid.pmtiles",
      minZoom: 3,
      maxZoom: 14,
      bounds: [13.5, 45.1, 18, 45.9],
    },
    boundaries: {
      url: "builds/20260916T120000Z/boundaries.pmtiles",
      minZoom: 0,
      maxZoom: 8,
      bounds: [5.5, 35, 24.5, 49.5],
    },
  },
  manifest: "builds/20260916T120000Z/manifest.json",
  search: "builds/20260916T120000Z/search.json",
  stats: "builds/20260916T120000Z/stats.json",
  downloads: {
    lines: "builds/20260916T120000Z/lines.ndjson.gz",
    substations: "builds/20260916T120000Z/substations.ndjson.gz",
    plants: "builds/20260916T120000Z/plants.ndjson.gz",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assetUrl", () => {
  it("resolves bucket keys under the data root", () => {
    expect(assetUrl(base, "builds/x/grid.pmtiles")).toBe("https://podaci.test/root/builds/x/grid.pmtiles");
  });

  it.each(["/etc/passwd", "https://evil.test/x", "javascript:alert(1)"])("rejects %s", (key) => {
    expect(() => assetUrl(base, key)).toThrow(DataError);
  });
});

describe("fetchJson", () => {
  const schema = z.object({ ok: z.boolean() });

  it("returns validated data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    await expect(fetchJson("https://x.test/a.json", schema)).resolves.toEqual({ ok: true });
  });

  it.each([
    ["network failure", () => Promise.reject(new TypeError("offline")), /Network error/],
    ["HTTP error", () => Promise.resolve(new Response("nope", { status: 503 })), /HTTP 503/],
    ["invalid JSON", () => Promise.resolve(new Response("<html>")), /not valid JSON/],
    ["wrong shape", () => Promise.resolve(new Response('{"ok":"yes"}')), /unexpected shape/],
  ])("turns %s into a DataError", async (_, impl, message) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    const promise = fetchJson("https://x.test/a.json", schema);
    await expect(promise).rejects.toBeInstanceOf(DataError);
    await expect(fetchJson("https://x.test/a.json", schema)).rejects.toThrow(message);
  });

  it("passes aborts through untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("stop", "AbortError")));
    await expect(fetchJson("https://x.test/a.json", schema)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("loadCurrent", () => {
  it("accepts what the pipeline publishes and busts the browser cache per minute", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(CURRENT_FIXTURE)));
    vi.stubGlobal("fetch", fetchMock);
    const current = await loadCurrent(base);
    expect(CurrentSchema.parse(current).buildId).toBe("20260916T120000Z");
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/podaci\.test\/root\/current\.json\?t=\d+$/,
    );
  });
});
