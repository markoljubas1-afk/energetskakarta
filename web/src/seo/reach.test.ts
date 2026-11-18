import { describe, expect, it } from "vitest";

import type { Diff } from "../data/diff";
import { apiFiles } from "./api";
import { atomFeed } from "./feed";
import type { SiteData } from "./pages";
import { staticFiles } from "./prerender";

const site: SiteData = {
  siteUrl: "https://karta.example",
  dataBaseUrl: "https://podaci.example/",
  current: {
    buildId: "20260919T074428Z",
    createdAt: "2026-09-19T07:44:28+00:00",
    counts: { lines: 1, substations: 1, plants: 1 },
    attribution: "x",
    license: "ODbL-1.0",
    tiles: {
      grid: { url: "b/grid.pmtiles", minZoom: 3, maxZoom: 14, bounds: [13, 44, 17, 46] },
      boundaries: { url: "b/boundaries.pmtiles", minZoom: 0, maxZoom: 8, bounds: [13, 44, 17, 46] },
    },
    manifest: "b/manifest.json",
    search: "b/search.json",
    stats: "b/stats.json",
    downloads: { lines: "b/l.gz", substations: "b/s.gz", plants: "b/p.gz", cities: "b/c.gz" },
    cities: "b/cities.json",
    diff: "b/diff.json",
  },
  stats: {
    version: 1,
    voltageClasses: [],
    note: "",
    plants: { HR: { hydro: { operating: { count: 1, capacityMw: 276, withCapacity: 1 } } } },
    substations: { HR: { "380+": 1 } },
    lineKm: { HR: { "380+": { operating: 39 } } },
  },
  index: {
    version: 1,
    fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
    rows: [
      ["osm:way/109", "RHE Primjer", "plants", "HR", 16.51, 45.81, "pumped_storage|276"],
      ["com:1001", "Grad Primjer", "cities", "HR", 16, 45.5, "2019|186500"],
      ["osm:node/60", "SE Mala", "plants", "HR", 16.3, 45.65, "solar|9.9"],
    ],
  },
  cities: {
    version: 1,
    fields: [],
    sectors: ["public_lighting", "residential"],
    rows: [
      [
        "com:1001",
        "Grad Primjer",
        "HR",
        16,
        45.5,
        121000,
        2019,
        false,
        186500,
        204500,
        2011,
        175000,
        [6500, 160000],
      ],
    ],
  },
  diff: {
    version: 1,
    buildId: "20260919T074428Z",
    baselineBuildId: "20260912T030000Z",
    layers: {
      plants: {
        added: 1,
        changed: 0,
        removed: 0,
        unchanged: 5,
        byCountry: { HR: { added: 1 } },
        examples: {
          added: [{ id: "osm:way/109", name: "RHE & Co", lon: 16.51, lat: 45.81 }],
          changed: [],
          removed: [],
        },
      },
      lines: {
        added: 0,
        changed: 0,
        removed: 0,
        unchanged: 3,
        byCountry: {},
        examples: { added: [], changed: [], removed: [] },
      },
    },
  } satisfies Diff,
};

describe("atom feed", () => {
  it("has a summary entry and one per layer with changes, with escaped links to the map", () => {
    const feed = atomFeed(site, site.diff, "hr");
    expect(feed).not.toBeNull();
    expect(feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="hr">');
    expect(feed).toContain("<id>https://karta.example/feed.xml</id>");
    expect((feed?.match(/<entry>/g) ?? []).length).toBe(2); // summary + plants; lines had no change
    expect(feed).toContain("RHE &amp;amp; Co"); // HTML inside XML: escaped twice, on purpose
    expect(feed).toContain("sel=osm%3Away%2F109");
    expect(feed).toContain("<updated>2026-09-19T07:44:28.000Z</updated>");
    expect(atomFeed(site, null, "hr")).toBeNull();
    expect(atomFeed({ ...site, siteUrl: null }, site.diff, "hr")).toBeNull();
    expect(atomFeed(site, site.diff, "en")).toContain("/en/feed.xml");
  });
});

describe("open JSON", () => {
  it("writes an index, every country, the page-worthy assets and the city register", () => {
    const files = apiFiles(site);
    expect([...files.keys()].sort()).toEqual(
      [
        "api/gradovi.json",
        "api/index.json",
        "api/objekt/com-1001.json",
        "api/objekt/osm-way-109.json",
        ...["at", "ba", "hr", "hu", "it", "me", "rs", "si"].map((c) => `api/zemlja/${c}.json`),
      ].sort(),
    );
    const plant = JSON.parse(files.get("api/objekt/osm-way-109.json") ?? "") as Record<string, unknown>;
    expect(plant).toMatchObject({
      kind: "plant",
      technology: "pumped_storage",
      capacityMw: 276,
      summary: true,
      links: {
        openstreetmap: "https://www.openstreetmap.org/way/109",
        fullRecords: "https://podaci.example/b/p.gz",
        page: "https://karta.example/objekt/osm-way-109/",
      },
    });
    const city = JSON.parse(files.get("api/objekt/com-1001.json") ?? "") as Record<string, unknown>;
    expect(city).toMatchObject({
      kind: "city",
      electricityBySectorMwh: { public_lighting: 6500 },
      baselineYear: 2011,
    });
    const hr = JSON.parse(files.get("api/zemlja/hr.json") ?? "") as Record<string, unknown>;
    expect(hr).toMatchObject({ country: "HR", operatingMw: 276, name: { hr: "Hrvatska", en: "Croatia" } });
    const index = JSON.parse(files.get("api/index.json") ?? "") as {
      assets: number;
      downloads: Record<string, string>;
    };
    expect(index.assets).toBe(2);
    expect(index.downloads.cities).toBe("https://podaci.example/b/c.gz");
  });

  it("is part of the static build, together with both feeds", () => {
    const files = staticFiles(site);
    expect(files.has("feed.xml")).toBe(true);
    expect(files.has("en/feed.xml")).toBe(true);
    expect(files.has("api/index.json")).toBe(true);
    expect(files.get("api/index.html")).toContain("WebAPI");
    // the API page describes the data it serves as a dataset as well
    expect(files.get("api/index.html")).toContain('"@type":"Dataset"');
    expect(files.get("o-karti/index.html")).toContain('type="application/atom+xml"');
  });
});
