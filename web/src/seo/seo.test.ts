import { describe, expect, it } from "vitest";

import type { Current } from "../data/current";
import type { SearchIndex } from "../data/search";
import type { Stats } from "../data/stats";
import { SCOPE_COUNTRIES } from "../domain";
import { renderNotFound, renderPage } from "./html";
import { ASSET_PAGE_MIN_KV, ASSET_PAGE_MIN_MW, assetSlug, buildPages, mapLink, type SiteData } from "./pages";
import { apiFiles } from "./api";
import { normalizeSiteUrl, staticFiles } from "./prerender";

const apiFilesOf = (data: SiteData): string[] => [...apiFiles(data).keys()];
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
    // per language: about, learning corner, who is behind it, API, largest plants (5) + 8 countries + HR
    // topic pages (pumped storage, solar, substations, data centres: 4) + 3 assets = 20
    expect(pages).toHaveLength(2 * (5 + SCOPE_COUNTRIES.length + 4 + 3));
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

  it("names a data set's area as a Place, the type Google takes for spatialCoverage", () => {
    const datasets = buildPages(site)
      .flatMap((page) => page.jsonLd)
      .filter((each) => each["@type"] === "Dataset" && "spatialCoverage" in each);
    expect(datasets.length).toBeGreaterThan(0);
    for (const dataset of datasets) {
      expect(dataset.spatialCoverage).toMatchObject({ "@type": "Place" });
    }
  });

  it("says a country has no plants or lines on the map, instead of an empty table (Faza 58-A)", () => {
    // the fixture's stats have Croatia only
    const si = buildPages(site).find((page) => page.path === "/zemlja/si/");
    expect(si?.sections[0]?.html).not.toContain("<table");
    expect(si?.sections[0]?.html).toContain("Na karti još nema elektrana iz ove zemlje.");
    expect(si?.sections[1]?.html).not.toContain("<table");
    expect(si?.sections[1]?.html).toContain("Na karti još nema dalekovoda iz ove zemlje.");
    const en = buildPages(site).find((page) => page.path === "/en/country/si/");
    expect(en?.sections[0]?.html).toContain("No power plants from this country are on the map yet.");
  });

  it("lists the API's addresses with their method and format, and an example asset that exists (Faza 58-A)", () => {
    const api = buildPages(site).find((page) => page.path === "/api/");
    const endpoints = api?.sections[0]?.html ?? "";
    expect(endpoints).toContain('<span class="method">GET</span>');
    expect(endpoints).toContain('<span class="format">JSON</span>');
    expect(endpoints).toMatch(/<code>[^<]*\/api\/objekt\/\{slug\}\.json<\/code>/);
    const example = /<a href="[^"]*?\/(api\/objekt\/[^"{]+\.json)">/.exec(endpoints)?.[1];
    expect(example).toBeDefined();
    expect(apiFilesOf(site)).toContain(example);
  });

  it("says page not found in both languages, alike, since it answers every address (Faza 58-A)", () => {
    const html = renderNotFound(site);
    expect(html).toContain("<title>Stranica nije pronađena · Page not found (404) – GridAtlas</title>");
    expect(html).toContain('<h1>Stranica nije pronađena <span lang="en">· Page not found</span></h1>');
    expect(html).toMatch(/<p class="lead" lang="en">This page does not exist/);
    expect(html).toContain('<a href="/en/" lang="en">');
  });

  it("fills a country page with the numbers of that country", () => {
    const hr = buildPages(site).find((page) => page.path === "/zemlja/hr/");
    expect(hr?.title).toBe("Hrvatska: elektrane, dalekovodi i trafostanice");
    expect(hr?.description).toContain("276 MW");
    expect(hr?.sections[0]?.html).toContain("Hidro");
    expect(hr?.sections[1]?.html).toContain("39 km");
    expect(hr?.sections[2]?.html).toContain('href="/?c=HR"');
    // Faza 54-3: the figures as tiles, the capacity as a chart with its table behind a click
    expect(hr?.figures).toContain('<p class="big">276<small>MW</small></p>');
    expect(hr?.figures).toContain("Elektrane u pogonu");
    expect(hr?.sections[0]?.html).toContain('<div class="mix" aria-hidden="true">');
    expect(hr?.sections[0]?.html).toContain('<details class="data"><summary>Tablica s brojkama</summary>');
    expect(hr?.sections[1]?.html).toContain('<div class="ranking">');
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

  it("has the map's bar on top: main pages, the rest under More, the way back to the map (Faza 54-1)", () => {
    const pages = buildPages(site);
    const about = pages.find((p) => p.path === "/o-karti/");
    if (!about) throw new Error("no about page");
    const html = renderPage(about, site);
    const nav = /<nav class="primary" aria-label="Glavna navigacija">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    // the open page is marked; Edukacija is a main link, API sits under More (and in the phone's row)
    expect(nav).toMatch(/<a href="\/o-karti\/" aria-current="page">/);
    expect(nav).toMatch(/<a href="\/edukacija\/">/);
    expect(nav).toMatch(/<details class="more"><summary>Više<\/summary><div>[\s\S]*href="\/api\/"/);
    expect(nav).toContain('<a href="/api/" class="phone">');
    expect(html).toMatch(/<a class="open-map" href="\/"[^>]*>[\s\S]*?Otvori kartu/);
    expect(html).toContain('href="/en/about/" lang="en" hreflang="en"');
    // the font every page asks for is the one in public/fonts
    expect(html).toContain('<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2"');
  });

  it("puts 'On this page' beside a page with enough sections, linking each heading", () => {
    const pages = buildPages(site);
    const long = pages.find((p) => p.sections.length >= 4);
    const short = pages.find((p) => p.sections.length < 4);
    if (!long || !short) throw new Error("the fixture needs a long and a short page");
    const html = renderPage(long, site);
    expect(html).toContain('<div class="body with-side">');
    // and at the top of the content for a phone, which has no side column (Faza 54-4)
    expect(html).toContain('<details class="toc-here"><summary>Na ovoj stranici</summary><nav class="toc"');
    const toc = /<nav class="toc"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    const links = [...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    const headings = [...html.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
    // every section of the page, in order, each to its own heading
    expect(links).toEqual(headings.slice(0, long.sections.length));
    expect(renderPage(short, site)).not.toContain('class="toc"');
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
    expect(text.startsWith("# GridAtlas")).toBe(true);
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

describe("about page", () => {
  it("says what the map is for, how to read it, how it is made, what it is not and where to fix a mistake", () => {
    const pages = buildPages(site);
    const hr = pages.find((page) => page.path === "/o-karti/");
    const en = pages.find((page) => page.path === "/en/about/");
    if (!hr || !en) throw new Error("the about pages are missing");
    expect(hr.sections.map((section) => section.heading)).toEqual(
      expect.arrayContaining([
        "Čemu karta služi",
        "Kako čitati kartu",
        "Kako karta nastaje",
        "Što karta nije",
        "Našli ste grešku?",
      ]),
    );
    // the same sections in the same order in both languages
    expect(en.sections).toHaveLength(hr.sections.length);
    expect(renderPage(en, site)).toContain("Nothing is estimated or filled in.");
    expect(renderPage(hr, site)).toContain("Ništa se ne procjenjuje ni ne nadopunjuje.");
  });
});

describe("who is behind the site", () => {
  it("has its own page in both languages, off the about page, without a citation", () => {
    const pages = buildPages(site);
    const hr = pages.find((page) => page.path === "/tko-stoji-iza/");
    const en = pages.find((page) => page.path === "/en/who-is-behind/");
    if (!hr || !en) throw new Error("the author page exists in both languages");
    expect(hr.alternatePath).toBe(en.path);
    const html = renderPage(hr, site);
    expect(html).toContain("<h1>Tko stoji iza GridAtlasa</h1>");
    expect(html).toContain('<img src="/keks-pay.png"');
    expect(html).toContain("KEKS tag: <strong>#markol363</strong>");
    expect(html).toContain('href="mailto:marko.ljubas1@gmail.com"');
    expect(html).not.toContain('class="cite"');
    const about = pages.find((page) => page.path === "/o-karti/");
    expect(about?.sections.map((section) => section.heading)).not.toContain("Tko stoji iza GridAtlasa");
    // every static page's footer leads there
    expect(renderPage(about ?? hr, site)).toContain('<a href="/tko-stoji-iza/">Tko stoji iza GridAtlasa</a>');
  });
});
