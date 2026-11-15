import { describe, expect, it } from "vitest";

import {
  describeResponse,
  INDEXNOW_MAX_URLS,
  indexNowPayloads,
  isValidKey,
  keyFileName,
  sitemapLocations,
} from "./indexnow";
import { staticFiles } from "./prerender";
import type { SiteData } from "./pages";

describe("IndexNow", () => {
  it("accepts only keys the protocol allows", () => {
    expect(isValidKey("0123456789abcdef")).toBe(true);
    expect(isValidKey("a1b2c3d4-e5f6")).toBe(true);
    expect(isValidKey("short")).toBe(false);
    expect(isValidKey("not hex!")).toBe(false);
    expect(isValidKey(undefined)).toBe(false);
    expect(keyFileName("abcdef1234")).toBe("abcdef1234.txt");
  });

  it("builds payloads of the site's own URLs only, in batches of ten thousand", () => {
    const urls = [
      "https://karta.example/",
      "https://karta.example/o-karti/",
      "https://karta.example/o-karti/", // duplicates collapse
      "https://elsewhere.example/x",
      "not a url",
    ];
    const [payload, ...rest] = indexNowPayloads("https://karta.example", "abcdef1234", urls);
    expect(rest).toEqual([]);
    expect(payload).toEqual({
      host: "karta.example",
      key: "abcdef1234",
      keyLocation: "https://karta.example/abcdef1234.txt",
      urlList: ["https://karta.example/", "https://karta.example/o-karti/"],
    });
    const many = Array.from({ length: INDEXNOW_MAX_URLS + 1 }, (_, i) => `https://karta.example/p/${i}/`);
    expect(indexNowPayloads("https://karta.example", "abcdef1234", many)).toHaveLength(2);
  });

  it("reads locations out of a sitemap and a sitemap index alike", () => {
    const xml = `<urlset><url><loc>https://k.example/a/?x=1&amp;y=2</loc></url><url><loc>https://k.example/b/</loc></url></urlset>`;
    expect(sitemapLocations(xml)).toEqual(["https://k.example/a/?x=1&y=2", "https://k.example/b/"]);
    expect(
      sitemapLocations(
        "<sitemapindex><sitemap><loc>https://k.example/sitemap-1.xml</loc></sitemap></sitemapindex>",
      ),
    ).toEqual(["https://k.example/sitemap-1.xml"]);
  });

  it("names the outcome of an engine's answer", () => {
    expect(describeResponse(200)).toBe("accepted");
    expect(describeResponse(202)).toBe("accepted");
    expect(describeResponse(403)).toBe("key-rejected");
    expect(describeResponse(429)).toBe("throttled");
    expect(describeResponse(500)).toBe("failed");
  });

  it("publishes the key file with the site, and nothing when the key is missing or malformed", () => {
    const site = {
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
        downloads: { lines: "b/l.gz", substations: "b/s.gz", plants: "b/p.gz" },
      },
      stats: { version: 1, voltageClasses: [], note: "", plants: {}, substations: {}, lineKm: {} },
      index: { version: 1, fields: ["id", "name", "layer", "country", "lon", "lat", "detail"], rows: [] },
      cities: null,
      diff: null,
    } satisfies SiteData;
    expect(staticFiles(site, "abcdef1234").get("abcdef1234.txt")).toBe("abcdef1234");
    expect(
      // the only .txt files without a key: robots.txt, llms.txt and llms-full.txt (16-C2)
      [...staticFiles(site).keys()].some(
        (k) => k.endsWith(".txt") && !["robots.txt", "llms.txt", "llms-full.txt"].includes(k),
      ),
    ).toBe(false);
    expect(staticFiles(site, "bad key").has("bad key.txt")).toBe(false);
  });
});
