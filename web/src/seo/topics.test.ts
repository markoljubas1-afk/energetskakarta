/**
 * SEO 2.0 (tasks/todo.md, Faza 16): topic pages, no orphan pages, breadcrumbs, titles with the key figure,
 * the home page head, the 404 page, a lastmod that only moves when content does, and the AI-facing files.
 */

import { describe, expect, it } from "vitest";

import type { Current } from "../data/current";
import type { SearchIndex } from "../data/search";
import type { Stats } from "../data/stats";
import { BODY_MARKER, HEAD_MARKER, homeHtml } from "./home";
import { breadcrumbJsonLd, renderPage } from "./html";
import { buildPages, groupHubs, HUB_ROWS, type SiteData, type StaticPage } from "./pages";
import {
  pageHash,
  parseSeoManifest,
  SEO_MANIFEST,
  seoManifest,
  staticFiles,
  type SeoManifest,
} from "./prerender";
import { llmsTxt, robotsTxt } from "./sitemap";
import { readTemplate } from "../test/template";

const current: Current = {
  buildId: "20260919T074428Z",
  createdAt: "2026-09-19T07:44:28+00:00",
  counts: { lines: 4, substations: 3, plants: 4 },
  attribution: "x",
  attributionSources: ["openstreetmap", "gem"],
  license: "ODbL-1.0",
  tiles: {
    grid: { url: "builds/b/grid.pmtiles", minZoom: 3, maxZoom: 14, bounds: [13, 44, 17, 46] },
    boundaries: { url: "builds/b/boundaries.pmtiles", minZoom: 0, maxZoom: 8, bounds: [13, 44, 17, 46] },
  },
  manifest: "builds/b/manifest.json",
  search: "builds/b/search.json",
  stats: "builds/b/stats.json",
  downloads: { lines: "builds/b/l.gz", substations: "builds/b/s.gz", plants: "builds/b/p.gz" },
};

const stats: Stats = {
  version: 1,
  voltageClasses: [],
  note: "",
  plants: { HR: { hydro: { operating: { count: 2, capacityMw: 316, withCapacity: 2 } } } },
  substations: { HR: { "380+": 1 } },
  lineKm: { HR: { "380+": { operating: 39 } } },
};

const index: SearchIndex = {
  version: 1,
  fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
  rows: [
    ["osm:way/1", "HE Mala", "plants", "HR", 16.1, 45.1, "hydro|40"],
    ["osm:way/2", "HE Velika", "plants", "HR", 16.2, 45.2, "hydro|276"],
    ["osm:node/3", "MHE Potok", "plants", "HR", 16.3, 45.3, "hydro|2.5"],
    ["osm:node/4", "SE Polje", "plants", "SI", 14.5, 46.0, "solar|12"],
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

const page = (path: string, of: SiteData = site): StaticPage => {
  const found = buildPages(of).find((p) => p.path === path);
  if (!found) throw new Error(`no page ${path}`);
  return found;
};

const template = readTemplate();

describe("topic pages", () => {
  it("make one page per country and kind of asset, in both languages, largest first", () => {
    const hubs = groupHubs(site);
    expect([...(hubs.get("HR")?.keys() ?? [])]).toEqual(["hydro", "substations", "datacenters"]);
    expect([...(hubs.get("SI")?.keys() ?? [])]).toEqual(["solar"]);
    expect(hubs.has("IT")).toBe(false); // no assets: no empty pages
    expect(
      hubs
        .get("HR")
        ?.get("hydro")
        ?.map((hit) => hit.name),
    ).toEqual(["HE Velika", "HE Mala", "MHE Potok"]);

    const hydro = page("/zemlja/hr/hidroelektrane/");
    expect(hydro.alternatePath).toBe("/en/country/hr/hydropower-plants/");
    expect(hydro.title).toBe("Hidroelektrane u Hrvatskoj: popis, snaga i karta");
    expect(hydro.heading).toBe("Hidroelektrane u Hrvatskoj");
    // 276 + 40 + 2.5 = 318.5 MW, shown rounded
    expect(hydro.lead).toContain("Ukupno na karti: 3");
    expect(hydro.lead).toContain("319 MW");
    expect(page("/en/country/si/solar-power-plants/").title).toBe(
      "Solar power plants in Slovenia: list, capacity and map",
    );
  });

  it("link the assets that have a page and list the others as plain text", () => {
    const html = page("/zemlja/hr/hidroelektrane/").sections[0]?.html ?? "";
    expect(html).toContain('<a href="/objekt/osm-way-2/">HE Velika</a>');
    expect(html).toContain('<a href="/objekt/osm-way-1/">HE Mala</a>');
    expect(html).toContain('<th scope="row">MHE Potok</th>'); // 2.5 MW: below the asset-page threshold
    expect(html.indexOf("HE Velika")).toBeLessThan(html.indexOf("HE Mala"));
    const substations = page("/zemlja/hr/trafostanice/").sections[0]?.html ?? "";
    expect(substations.indexOf("Žerjavinec")).toBeLessThan(substations.indexOf("TS Area"));
    expect(substations).toContain("400 kV");
  });

  it("say when the list is cut at the row limit", () => {
    const many: SiteData = {
      ...site,
      index: {
        ...index,
        rows: Array.from({ length: HUB_ROWS + 3 }, (_, i) => [
          `osm:node/${1000 + i}`,
          `SE ${i}`,
          "plants",
          "HR",
          16,
          45,
          `solar|${1 + i / 1000}`,
        ]),
      },
    };
    const solar = page("/zemlja/hr/suncane-elektrane/", many);
    expect(solar.sections[0]?.html.match(/<tr>/g)).toHaveLength(HUB_ROWS + 1); // + header row
    expect(solar.sections[0]?.html).toContain("Prikazano je 500 najvećih od 503");
  });

  it("are linked from the country page with their counts", () => {
    const hr = page("/zemlja/hr/");
    const hubs = hr.sections.find((section) => section.heading === "Po vrstama objekata");
    expect(hubs?.html).toContain('<a href="/zemlja/hr/hidroelektrane/">Hidroelektrane</a> (3)');
    expect(hubs?.html).toContain('<a href="/zemlja/hr/trafostanice/">Trafostanice</a> (2)');
    expect(page("/zemlja/it/").sections.some((s) => s.heading === "Po vrstama objekata")).toBe(false);
  });

  it("include the largest plants of the region in one list", () => {
    const largest = page("/najvece-elektrane/");
    expect(largest.alternatePath).toBe("/en/largest-power-plants/");
    const html = largest.sections[0]?.html ?? "";
    expect(html.indexOf("HE Velika")).toBeLessThan(html.indexOf("SE Polje"));
    expect(html).toContain("Slovenija");
    expect(largest.jsonLd[0]).toMatchObject({ "@type": "ItemList", numberOfItems: 4 });
  });
});

describe("internal links", () => {
  it("reach every static page from the home page within three clicks (no orphans)", () => {
    const files = staticFiles(site, undefined, { template });
    const pagePaths = buildPages(site).map((p) => p.path);
    const htmlOf = (path: string): string | undefined =>
      files.get(path === "/" ? "index.html" : `${path.slice(1)}index.html`);
    const depth = new Map<string, number>([["/", 0]]);
    const queue = ["/"];
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const html = htmlOf(path) ?? "";
      for (const [, href] of html.matchAll(/href="(\/[^"?#]*\/)"/g)) {
        if (href && !depth.has(href) && htmlOf(href) !== undefined) {
          depth.set(href, (depth.get(path) ?? 0) + 1);
          queue.push(href);
        }
      }
    }
    const unreachable = pagePaths.filter((p) => !depth.has(p));
    expect(unreachable).toEqual([]);
    const deepest = Math.max(...pagePaths.map((p) => depth.get(p) ?? 99));
    expect(deepest).toBeLessThanOrEqual(3);
  });
});

describe("asset pages", () => {
  it("carry the key figure in the title and never print empty brackets", async () => {
    expect(page("/objekt/osm-way-2/").title).toBe("HE Velika: hidroelektrana 276 MW, Hrvatska");
    const { assetTitle } = await import("./copy");
    expect(assetTitle("Hidroelektrana Zakučac", "hidroelektrana", "538 MW", "Hrvatska")).toBe(
      "Hidroelektrana Zakučac: 538 MW, Hrvatska",
    );
    expect(assetTitle("Trafostanica Ernestinovo", "trafostanica", "", "Hrvatska")).toBe(
      "Trafostanica Ernestinovo, Hrvatska",
    );
    expect(page("/en/asset/osm-way-2/").title).toBe("HE Velika: hydropower plant 276 MW, Croatia");
    expect(page("/objekt/osm-node-50/").title).toBe("TS Žerjavinec: trafostanica 400 kV, Hrvatska");
    const dc = page("/objekt/dc-primjer/");
    expect(dc.title).toBe("DC Primjer: podatkovni centar, Hrvatska");
    expect(dc.description).toBe(
      "Podatkovni centar DC Primjer, Hrvatska. Podaci, izvori i položaj na GridAtlasu.",
    );
    expect(dc.description).not.toContain("()");
  });

  it("show the trail home › country › topic and describe it as a BreadcrumbList", () => {
    const plant = page("/objekt/osm-way-2/");
    expect(plant.breadcrumbs).toEqual([
      { name: "Početna", path: "/" },
      { name: "Hrvatska", path: "/zemlja/hr/" },
      { name: "Hidroelektrane", path: "/zemlja/hr/hidroelektrane/" },
    ]);
    const html = renderPage(plant, site);
    expect(html).toContain('<nav class="crumbs" aria-label="Putanja">');
    expect(html).toContain('<li aria-current="page">HE Velika</li>');
    expect(breadcrumbJsonLd(plant, site)).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Početna", item: "https://karta.example/" },
        { "@type": "ListItem", position: 2, name: "Hrvatska", item: "https://karta.example/zemlja/hr/" },
        {
          "@type": "ListItem",
          position: 3,
          name: "Hidroelektrane",
          item: "https://karta.example/zemlja/hr/hidroelektrane/",
        },
        {
          "@type": "ListItem",
          position: 4,
          name: "HE Velika",
          item: "https://karta.example/objekt/osm-way-2/",
        },
      ],
    });
    expect(breadcrumbJsonLd(plant, { ...site, siteUrl: null })).toBeNull();
    expect(page("/en/asset/osm-way-2/").breadcrumbs[0]).toEqual({ name: "Home", path: "/en/" });
  });

  it("link to their topic page, their country and their open JSON twin", () => {
    const plant = page("/objekt/osm-way-2/");
    const html = renderPage(plant, site);
    expect(html).toContain('<a href="/zemlja/hr/hidroelektrane/">Hidroelektrane u Hrvatskoj</a>');
    expect(html).toContain(
      '<link rel="alternate" type="application/json" href="https://karta.example/api/objekt/osm-way-2.json">',
    );
    expect(renderPage(page("/zemlja/hr/"), site)).toContain(
      '<link rel="alternate" type="application/json" href="https://karta.example/api/zemlja/hr.json">',
    );
  });
});

describe("home page", () => {
  it("gets an absolute canonical, share image and WebSite address, and a summary per country", () => {
    const html = homeHtml(template, site);
    expect(html).not.toContain(HEAD_MARKER);
    expect(html).not.toContain(BODY_MARKER);
    expect(html).toContain('<link rel="canonical" href="https://karta.example/">');
    expect(html).toContain('<meta property="og:image" content="https://karta.example/og-gridatlas.png">');
    expect(html).toContain('<meta property="og:url" content="https://karta.example/">');
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
      ([, body]) => JSON.parse(body ?? "{}") as Record<string, unknown>,
    );
    expect(ld.find((doc) => doc["@type"] === "WebSite")?.url).toBe("https://karta.example/");
    expect(html).toContain('<a href="/zemlja/hr/">Hrvatska</a></td><td>316 MW</td>');
    expect(html).toContain('<a href="/najvece-elektrane/">');
    // no relative hreflang left behind (Google ignores relative alternates)
    expect(html).not.toMatch(/hreflang="[a-z-]+" href="\//);
  });

  it("has an English twin at /en/ with its own language, title, intro and alternates", () => {
    const en = homeHtml(template, site, "en");
    expect(en).toContain('<html lang="en" data-theme="dark">');
    expect(en).toContain("<title>GridAtlas: energy map of Croatia, power plants, grid, gas</title>");
    expect(en).toContain('<link rel="canonical" href="https://karta.example/en/">');
    expect(en).toContain('<meta property="og:locale" content="en_GB" />');
    expect(en).toContain("<h1>GridAtlas: Regional energy map</h1>");
    expect(en).not.toContain("<h1>GridAtlas: Regionalna energetska karta</h1>");
    expect(en).toContain('<a href="/en/country/hr/">Croatia</a></td><td>316 MW</td>');
    expect(en).toContain('<p lang="hr">Na hrvatskom:');
    for (const html of [en, homeHtml(template, site, "hr")]) {
      expect(html).toContain('<link rel="alternate" hreflang="hr" href="https://karta.example/">');
      expect(html).toContain('<link rel="alternate" hreflang="en" href="https://karta.example/en/">');
      expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://karta.example/">');
    }
    // the built app (scripts, styles) is the same on both
    const scripts = (html: string): string[] =>
      [...html.matchAll(/<script type="module"[^>]*>/g)].map(([tag]) => tag);
    expect(scripts(en)).toEqual(scripts(template));
    const files = staticFiles(site, undefined, { template });
    expect(files.get("en/index.html")).toBe(en);
    expect(files.get("sitemap.xml")).toContain("<loc>https://karta.example/en/</loc>");
  });

  it("keeps working without a site address, and refuses a template without markers", () => {
    const bare = homeHtml(template, { ...site, siteUrl: null });
    expect(bare).not.toContain('rel="canonical"');
    expect(bare).toContain('<meta property="og:image" content="/og-gridatlas.png">');
    expect(() => homeHtml("<html><head></head><body></body></html>", site)).toThrow("marker");
  });
});

describe("404 page", () => {
  it("exists, says so in both languages and asks not to be indexed", () => {
    const html = staticFiles(site).get("404.html") ?? "";
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain("Stranica nije pronađena");
    expect(html).toContain('lang="en"');
    expect(html).toContain('<a href="/zemlja/hr/">Hrvatska</a>');
  });
});

describe("lastmod", () => {
  it("keeps the date of unchanged pages and moves it only for changed or new ones", () => {
    const pages = buildPages(site);
    const first = seoManifest(pages, null, "b1", "2026-09-19");
    expect(new Set(Object.values(first.pages).map((entry) => entry.lastmod))).toEqual(
      new Set(["2026-09-19"]),
    );

    const older: SeoManifest = {
      ...first,
      pages: Object.fromEntries(
        Object.entries(first.pages).map(([k, v]) => [k, { ...v, lastmod: "2026-09-01" }]),
      ),
    };
    const renamed: SiteData = {
      ...site,
      index: {
        ...index,
        rows: index.rows.map((row) =>
          row[0] === "osm:way/2"
            ? ["osm:way/2", "HE Velika Nova", "plants", "HR", 16.2, 45.2, "hydro|276"]
            : row,
        ),
      },
    };
    const next = seoManifest(buildPages(renamed), older, "b2", "2026-09-26");
    expect(next.pages["/zemlja/hr/"]?.lastmod).toBe("2026-09-01"); // the country summary did not change
    expect(next.pages["/objekt/osm-way-2/"]?.lastmod).toBe("2026-09-26"); // the renamed plant did
    expect(next.pages["/zemlja/hr/hidroelektrane/"]?.lastmod).toBe("2026-09-26"); // and the list with it
  });

  it("is what the sitemap says, and the manifest is published for the next build", () => {
    const previous: SeoManifest = {
      version: 1,
      buildId: "b0",
      pages: { "/zemlja/hr/": { hash: pageHash(page("/zemlja/hr/")), lastmod: "2026-08-01" } },
    };
    const files = staticFiles(site, undefined, { previous });
    expect(files.get("sitemap.xml")).toContain(
      "<loc>https://karta.example/zemlja/hr/</loc><lastmod>2026-08-01</lastmod>",
    );
    expect(files.get("sitemap.xml")).toContain(
      "<loc>https://karta.example/o-karti/</loc><lastmod>2026-09-19</lastmod>",
    );
    const manifest = parseSeoManifest(JSON.parse(files.get(SEO_MANIFEST) ?? "null"));
    expect(manifest?.pages["/zemlja/hr/"]?.lastmod).toBe("2026-08-01");
  });

  it("ignores a manifest that is not ours", () => {
    expect(parseSeoManifest(null)).toBeNull();
    expect(parseSeoManifest({ version: 2, buildId: "x", pages: {} })).toBeNull();
    expect(
      parseSeoManifest({ version: 1, buildId: "x", pages: { "/a/": { hash: "h", lastmod: "yesterday" } } })
        ?.pages,
    ).toEqual({});
  });
});

describe("files for search engines and assistants", () => {
  it("name the AI search crawlers and user fetchers, not only the training ones", () => {
    const text = robotsTxt("https://karta.example");
    for (const agent of [
      "OAI-SearchBot",
      "ChatGPT-User",
      "Claude-SearchBot",
      "Claude-User",
      "Perplexity-User",
    ]) {
      expect(text).toContain(`User-agent: ${agent}\nAllow: /`);
    }
  });

  it("list the topic pages and the largest plants in llms.txt", () => {
    const text = llmsTxt(site);
    expect(text).toContain("[hydropower plants](https://karta.example/en/country/hr/hydropower-plants/)");
    expect(text).toContain("(https://karta.example/en/largest-power-plants/)");
  });

  it("describe the dataset with its publisher and the region as a box", () => {
    const about = page("/o-karti/");
    expect(about.jsonLd[0]).toMatchObject({
      "@type": "Dataset",
      creator: {
        "@type": "Organization",
        name: "GridAtlas",
        url: "https://karta.example/",
      },
      spatialCoverage: { "@type": "Place", geo: { "@type": "GeoShape", box: "44 13 46 17" } },
    });
  });
});

describe("licence of the downloads (decision 2026-11-08)", () => {
  it("says ODbL and non-commercial as a whole, in the dataset, the API and llms.txt", () => {
    expect(page("/o-karti/").jsonLd[0]).toMatchObject({
      license: [
        "https://opendatacommons.org/licenses/odbl/1-0/",
        "https://creativecommons.org/licenses/by-nc/4.0/",
      ],
    });
    expect(page("/o-karti/").sections.find((s) => s.heading === "Preuzimanje baze")?.html).toContain(
      "samo za nekomercijalnu upotrebu",
    );
    expect(llmsTxt(site)).toContain("non-commercial as a whole");
    const index = JSON.parse(staticFiles(site).get("api/index.json") ?? "{}") as {
      license?: { use?: string };
    };
    expect(index.license?.use).toBe("non-commercial (as a whole)");
  });
});
