import { describe, expect, it } from "vitest";

import type { Current } from "../data/current";
import type { SearchIndex } from "../data/search";
import type { Stats } from "../data/stats";
import { SCOPE_COUNTRIES } from "../domain";
import { renderPage } from "./html";
import { ASSET_PAGE_MIN_KV, ASSET_PAGE_MIN_MW, assetSlug, buildPages, mapLink, type SiteData } from "./pages";
import { normalizeSiteUrl, staticFiles } from "./prerender";
import { llmsTxt, robotsTxt, SITEMAP_CHUNK, sitemapFiles } from "./sitemap";

const current: Current = {
  buildId: "20260919T074428Z",
  createdAt: "2026-09-19T07:44:28+00:00",
  counts: { lines: 4, substations: 2, plants: 7 },
  attribution: "x",
  attributionSources: ["openstreetmap", "gem", "naturalearth"],
  license: "ODbL-1.0",
  tiles: {
    grid: { url: "builds/b/grid.pmtiles", minZoom: 3, maxZoom: 14, bounds: [13, 44, 17, 46] },
    boundaries: { url: "builds/b/boundaries.pmtiles", minZoom: 0, maxZoom: 8, bounds: [13, 44, 17, 46] },
  },
  manifest: "builds/b/manifest.json",
  search: "builds/b/search.json",
  stats: "builds/b/stats.json",
  downloads: {
    lines: "builds/b/lines.ndjson.gz",
    substations: "builds/b/s.ndjson.gz",
    plants: "builds/b/p.ndjson.gz",
  },
};

const stats: Stats = {
  version: 1,
  voltageClasses: [],
  note: "",
  plants: { HR: { hydro: { operating: { count: 1, capacityMw: 276, withCapacity: 1 } } } },
  substations: { HR: { "380+": 1 } },
  lineKm: { HR: { "380+": { operating: 39 } } },
};

const index: SearchIndex = {
  version: 1,
  fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
  rows: [
    ["osm:way/109", "RHE <Primjer> & Co", "plants", "HR", 16.51, 45.81, "pumped_storage|276"],
    ["osm:node/60", "SE Mala", "plants", "HR", 16.3, 45.65, "solar|9.9"],
    ["osm:node/50", "TS Žerjavinec", "substations", "HR", 15.95, 45.55, "400"],
    ["osm:way/108", "TS Area", "substations", "HR", 15.9, 45.4, "110"],
    ["dc:primjer", "DC Primjer", "datacenters", "HR", 15.95, 45.78, ""],
  ],
};

const site: SiteData = {
  siteUrl: "https://karta.example",
  dataBaseUrl: "https://podaci.example/",
  current,
  stats,
  index,
  cities: null,
  diff: null,
};

describe("buildPages", () => {
  it("makes an about page and a page per country in both languages, plus the assets worth one", () => {
    const pages = buildPages(site);
    const paths = pages.map((page) => page.path);
    expect(paths).toContain("/o-karti/");
    expect(paths).toContain("/en/about/");
    expect(paths).toContain("/api/");
    expect(paths).toContain("/en/api/");
    for (const code of SCOPE_COUNTRIES) {
      expect(paths).toContain(`/zemlja/${code.toLowerCase()}/`);
      expect(paths).toContain(`/en/country/${code.toLowerCase()}/`);
    }
    // 276 MW plant, 400 kV substation and the data centre: yes; 9.9 MW plant and 110 kV substation: no
    expect(paths.filter((p) => p.startsWith("/objekt/"))).toEqual([
      "/objekt/osm-way-109/",
      "/objekt/osm-node-50/",
      "/objekt/dc-primjer/",
    ]);
    // per language: about, API, largest plants (3) + 8 countries + HR topic pages (pumped storage, solar,
    // substations, data centres: 4) + 3 assets = 18
    expect(pages).toHaveLength(2 * (3 + SCOPE_COUNTRIES.length + 4 + 3));
    expect(ASSET_PAGE_MIN_MW).toBe(10);
    expect(ASSET_PAGE_MIN_KV).toBe(220);
  });

  it("pairs every page with its translation", () => {
    const pages = buildPages(site);
    const byPath = new Map(pages.map((page) => [page.path, page]));
    for (const page of pages) {
      const twin = byPath.get(page.alternatePath);
      expect(twin, page.path).toBeDefined();
      expect(twin?.alternatePath).toBe(page.path);
      expect(twin?.lang).not.toBe(page.lang);
    }
  });

  it("fills a country page with the numbers of that country", () => {
    const hr = buildPages(site).find((page) => page.path === "/zemlja/hr/");
    expect(hr?.title).toBe("Hrvatska: elektrane, dalekovodi i trafostanice");
    expect(hr?.description).toContain("276 MW");
    expect(hr?.sections[0]?.html).toContain("Hidro");
    expect(hr?.sections[1]?.html).toContain("39 km");
    expect(hr?.sections[2]?.html).toContain('href="/?c=HR"');
    const en = buildPages(site).find((page) => page.path === "/en/country/hr/");
    expect(en?.sections[2]?.html).toContain('href="/en/?c=HR"');
  });

  it("escapes names and links the asset to the map and to OpenStreetMap", () => {
    const page = buildPages(site).find((p) => p.path === "/objekt/osm-way-109/");
    if (!page) throw new Error("no page for the plant");
    expect(page.heading).toBe("RHE <Primjer> & Co");
    const html = renderPage(page, site);
    expect(html).toContain("RHE &lt;Primjer&gt; &amp; Co");
    expect(html).not.toContain("<Primjer>");
    expect(html).toContain('href="/?sel=osm%3Away%2F109&amp;v=45.8100%2C16.5100%2C12"');
    expect(html).toContain('href="https://www.openstreetmap.org/way/109"');
    expect(page.jsonLd[0]).toMatchObject({ "@type": "Place", geo: { latitude: 45.81, longitude: 16.51 } });
  });

  it("derives stable slugs and map links", () => {
    expect(assetSlug("osm:way/109")).toBe("osm-way-109");
    expect(assetSlug("gem:L100000000001:planned")).toBe("gem-L100000000001-planned");
    expect(mapLink("hr", {})).toBe("/");
    expect(mapLink("en", { sel: "a b" })).toBe("/en/?sel=a+b");
    expect(mapLink("en", {})).toBe("/en/");
  });
});

describe("renderPage", () => {
  it("gives every page what a crawler needs, and drops absolute links without a site URL", () => {
    for (const page of buildPages(site)) {
      const html = renderPage(page, site);
      expect(html).toMatch(/^<!doctype html>\n<html lang="(hr|en)">/);
      expect(html).toContain(`<link rel="canonical" href="https://karta.example${page.path}">`);
      expect(html).toContain(`hreflang="x-default"`);
      expect(html).toContain('<meta name="description"');
      const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
      expect(scripts.length).toBeGreaterThan(0);
      for (const [, body] of scripts) {
        expect(() => {
          JSON.parse(body ?? "");
        }).not.toThrow();
      }
      expect(html).not.toContain("<script src");
    }
    const [first] = buildPages(site);
    if (!first) throw new Error("no pages");
    const bare = renderPage(first, { ...site, siteUrl: null });
    expect(bare).not.toContain('rel="canonical"');
    expect(bare).not.toContain("og:url");
  });

  it("ends JSON-LD safely even when a name contains a closing script tag", () => {
    const evil: SiteData = {
      ...site,
      index: { ...index, rows: [["osm:node/1", "</script><b>x", "plants", "HR", 16, 45, "hydro|500"]] },
    };
    const page = buildPages(evil).find((p) => p.path === "/objekt/osm-node-1/");
    if (!page) throw new Error("no page for the plant");
    const html = renderPage(page, evil);
    expect(html).not.toContain("</script><b>x");
  });
});

describe("sitemap, robots and llms.txt", () => {
  it("lists the home page and every static page with language alternates", () => {
    const pages = buildPages(site);
    const [file] = sitemapFiles("https://karta.example", pages, current.createdAt);
    expect(file?.path).toBe("/sitemap.xml");
    expect(file?.xml).toContain("<loc>https://karta.example/</loc>");
    // + the map in both languages
    expect(file?.xml.match(/<url>/g)).toHaveLength(pages.length + 2);
    expect(file?.xml).toContain('hreflang="en" href="https://karta.example/en/country/hr/"');
    expect(file?.xml).toContain("<lastmod>2026-09-19</lastmod>");
  });

  it("splits into an index once the list is long", () => {
    const [first] = buildPages(site);
    if (!first) throw new Error("no pages");
    const many = Array.from({ length: SITEMAP_CHUNK + 5 }, (_, i) => ({ ...first, path: `/objekt/x-${i}/` }));
    const files = sitemapFiles("https://karta.example", many, current.createdAt);
    expect(files.map((f) => f.path)).toEqual(["/sitemap.xml", "/sitemap-1.xml", "/sitemap-2.xml"]);
    expect(files[0]?.xml).toContain("<sitemapindex");
  });

  it("welcomes AI crawlers and points at the sitemap", () => {
    const text = robotsTxt("https://karta.example");
    expect(text).toContain("User-agent: GPTBot\nAllow: /");
    expect(text).toContain("User-agent: ClaudeBot\nAllow: /");
    expect(text).not.toContain("Disallow");
    expect(text).toContain("Sitemap: https://karta.example/sitemap.xml");
    expect(robotsTxt(null)).not.toContain("Sitemap:");
  });

  it("describes the site for assistants with working links", () => {
    const text = llmsTxt(site);
    expect(text.startsWith("# Regional Energy Map")).toBe(true);
    expect(text).toContain("(https://karta.example/en/about/)");
    expect(text).toContain("(https://podaci.example/builds/b/lines.ndjson.gz)");
    expect(text).toContain("ODbL");
  });
});

describe("staticFiles", () => {
  it("writes pages as directory indexes and leaves the sitemap out without a site URL", () => {
    const files = staticFiles(site);
    expect(files.has("o-karti/index.html")).toBe(true);
    expect(files.has("en/asset/osm-way-109/index.html")).toBe(true);
    expect(files.has("robots.txt")).toBe(true);
    expect(files.has("llms.txt")).toBe(true);
    expect(files.has("sitemap.xml")).toBe(true);
    expect([...files.keys()].every((key) => !key.startsWith("/"))).toBe(true);
    expect(staticFiles({ ...site, siteUrl: null }).has("sitemap.xml")).toBe(false);
  });
});

describe("normalizeSiteUrl", () => {
  it("accepts an origin, strips a trailing slash and rejects anything else", () => {
    expect(normalizeSiteUrl("https://karta.example/")).toBe("https://karta.example");
    expect(normalizeSiteUrl(" https://karta.example ")).toBe("https://karta.example");
    expect(normalizeSiteUrl("https://karta.example/put")).toBeNull();
    expect(normalizeSiteUrl("karta.example")).toBeNull();
    expect(normalizeSiteUrl(undefined)).toBeNull();
  });
});
