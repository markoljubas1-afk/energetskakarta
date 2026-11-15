/** A release with almost nothing in it, for tests of pages that bring their own data (transition, geothermal…). */
import type { Current } from "../data/current";
import type { SiteData } from "./pages";

export const SAMPLE_CURRENT: Current = {
  buildId: "20261115T060000Z",
  createdAt: "2026-11-15T06:00:00+00:00",
  counts: { lines: 1, substations: 1, plants: 1 },
  attribution: "x",
  license: "ODbL-1.0",
  tiles: {
    grid: { url: "b/grid.pmtiles", minZoom: 3, maxZoom: 14, bounds: [13, 42, 20, 47] },
    boundaries: { url: "b/boundaries.pmtiles", minZoom: 0, maxZoom: 8, bounds: [13, 42, 20, 47] },
  },
  manifest: "b/manifest.json",
  search: "b/search.json",
  stats: "b/stats.json",
  downloads: { lines: "b/l.gz", substations: "b/s.gz", plants: "b/p.gz" },
};

/** The bare site, with whatever a test adds (`current` overrides merge into SAMPLE_CURRENT). */
export function bareSite(
  extra: Omit<Partial<SiteData>, "current"> & { current?: Partial<Current> } = {},
): SiteData {
  const { current, ...rest } = extra;
  return {
    siteUrl: "https://karta.example",
    dataBaseUrl: "https://podaci.example/",
    current: { ...SAMPLE_CURRENT, ...current },
    stats: { version: 1, voltageClasses: [], note: "", plants: {}, substations: {}, lineKm: {} },
    index: { version: 1, fields: ["id", "name", "layer", "country", "lon", "lat", "detail"], rows: [] },
    cities: null,
    diff: null,
    ...rest,
  };
}
