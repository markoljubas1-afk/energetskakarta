import { SOURCE_TERMS } from "./license";
import { describe, expect, it } from "vitest";

import type { Current } from "../data/current";
import { HISTORY, RELEASE } from "../data/hep.fixture";
import { apiFiles } from "./api";
import { stationSlugs } from "./capacity";
import { renderPage } from "./html";
import { buildPages, type SiteData, type StaticPage } from "./pages";
import { staticFiles } from "./prerender";
import { llmsTxt } from "./sitemap";
import { SAMPLE_CURRENT } from "./site.fixture";
import { readTemplate } from "../test/template";

const current: Current = {
  ...SAMPLE_CURRENT,
  buildId: "20261108T060000Z",
  createdAt: "2026-11-08T06:00:00+00:00",
};

const site: SiteData = {
  siteUrl: "https://karta.example",
  dataBaseUrl: "https://podaci.example/",
  current,
  stats: { version: 1, voltageClasses: [], note: "", plants: {}, substations: {}, lineKm: {} },
  index: { version: 1, fields: ["id", "name", "layer", "country", "lon", "lat", "detail"], rows: [] },
  cities: null,
  diff: null,
  capacity: RELEASE,
  capacityHistory: HISTORY,
};

const pages = buildPages(site);
const page = (path: string): StaticPage => {
  const found = pages.find((p) => p.path === path);
  if (!found) throw new Error(`no page ${path}`);
  return found;
};
const html = (path: string): string => renderPage(page(path), site);

describe("grid capacity pages", () => {
  it("make an overview and one page per substation in both languages", () => {
    const paths = pages.map((p) => p.path);
    expect(paths).toContain("/kapaciteti/");
    expect(paths).toContain("/en/grid-capacity/");
    expect(paths).toContain("/kapaciteti/ts-110-35kv-4ts-117-jertovec/");
    expect(paths).toContain("/en/grid-capacity/ts-35-20-10kv-ilovac/");
    // 10 substations + the overview, twice
    expect(
      paths.filter((p) => p.startsWith("/kapaciteti/") || p.startsWith("/en/grid-capacity/")),
    ).toHaveLength(22);
    expect(page("/kapaciteti/").alternatePath).toBe("/en/grid-capacity/");
    expect(buildPages({ ...site, capacity: null }).some((p) => p.path === "/kapaciteti/")).toBe(false);
  });

  it("open with the citable line: how many substations take nothing new, now and with an upgrade", () => {
    expect(page("/kapaciteti/").lead).toContain(
      "(stanje 1. studenoga 2026., verzija 5) u postojećoj mreži 6 od 10 trafostanica nema mogućnosti prihvata nove proizvodnje; uz nadogradnju transformacije 110/x kV bilo bi ih 5.",
    );
    expect(page("/en/grid-capacity/").lead).toContain(
      "6 of 10 substations in the existing network take no new generation",
    );
  });

  it("show the analytics: categories, areas, trend, changes and where an upgrade helps", () => {
    const overview = page("/kapaciteti/");
    const heading = (start: string): string =>
      overview.sections.find((section) => section.heading.startsWith(start))?.html ?? "";
    expect(heading("Kategorije prihvata")).toContain(
      '<th scope="row">nema mogućnosti prihvata</th><td class="num">6</td><td class="num">5</td>',
    );
    // the locale puts a no-break space before "%", hence \s
    expect(heading("Po distribucijskom području")).toMatch(
      /<th scope="row">Elektra Bjelovar<\/th><td class="num">1<\/td><td class="num">1 \(100\s%\)<\/td>/,
    );
    expect(heading("Kroz izdanja")).toContain("1. listopada 2026. (v4)");
    const changes = heading("Promjene između");
    expect(changes).toContain("Manje mjesta (2)");
    expect(changes).toContain(
      '<a href="/kapaciteti/ts-35-20-10kv-ilovac/">TS 35/20/10kV ILOVAC</a>: B: do 10 MW → nema mogućnosti prihvata',
    );
    const upgrade = heading("Gdje bi nadogradnja");
    expect(upgrade.indexOf("ILOVAC")).toBeLessThan(upgrade.indexOf("POKUPJE"));
    expect(heading("Izvor i napomena")).toContain("ne može jamčiti");
    expect(heading("Izvor i napomena")).toContain('href="https://kapaciteti.hep.hr/"');
  });

  it("give each substation its figures, its parent, the substations it feeds and its history", () => {
    const ilovac = page("/kapaciteti/ts-35-20-10kv-ilovac/");
    expect(ilovac.title).toBe("TS 35/20/10kV ILOVAC: slobodni kapacitet za priključenje");
    expect(ilovac.breadcrumbs.map((crumb) => crumb.name)).toEqual([
      "Početna",
      "Slobodni kapaciteti distribucijske mreže (HEP ODS)",
      "TS 110/35kV POKUPJE",
    ]);
    const body = html("/kapaciteti/ts-35-20-10kv-ilovac/");
    expect(body).toContain(
      '<dt>Napaja je</dt><dd><a href="/kapaciteti/ts-110-35kv-pokupje/">TS 110/35kV POKUPJE</a></dd>',
    );
    expect(body).toContain("<dt>Prijenosni omjer</dt><dd>35/20/10 kV</dd>");
    expect(body).toContain("<dt>Transformacija (MVA)</dt><dd>8 + 8 + 8</dd>");
    // history: B with 7.1 MW in version 4, nothing in version 5
    expect(body).toContain(
      '<th scope="row">1. listopada 2026. (v4)</th><td>B: do 10 MW</td><td class="num">7,1 MW</td>',
    );
    expect(html("/kapaciteti/ts-110-35kv-pokupje/")).toContain(
      '<a href="/kapaciteti/ts-35-20-10kv-ilovac/">TS 35/20/10kV ILOVAC</a>',
    );
    // empty figures are left out, not shown as 0
    const jertovec = html("/kapaciteti/ts-110-35kv-4ts-117-jertovec/");
    expect(jertovec).not.toContain("<dt>Slobodni kapacitet</dt>");
    expect(page("/kapaciteti/4ts26-ts-110-20-kv-novalja/").jsonLd[0]).not.toHaveProperty("geo");
  });

  it("describe a substation as a Place and the overview as a Dataset by HEP ODS", () => {
    expect(page("/kapaciteti/ts-110-35kv-pokupje/").jsonLd[0]).toMatchObject({
      "@type": "Place",
      geo: { latitude: 45.535741, longitude: 15.551805 },
      isBasedOn: "https://kapaciteti.hep.hr/",
    });
    expect(page("/kapaciteti/").jsonLd[0]).toMatchObject({
      "@type": "Dataset",
      creator: { name: "HEP ODS" },
      license: SOURCE_TERMS.hepOds,
      temporalCoverage: "2026-10-01/2026-11-01",
      distribution: [{ contentUrl: "https://podaci.example/hep/current.json" }],
    });
  });

  it("are reachable from the home page within three clicks", () => {
    const template = readTemplate();
    const files = staticFiles(site, undefined, { template });
    const htmlOf = (path: string): string | undefined =>
      files.get(path === "/" ? "index.html" : `${path.slice(1)}index.html`);
    const depth = new Map<string, number>([["/", 0]]);
    const queue = ["/"];
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      for (const [, href] of (htmlOf(path) ?? "").matchAll(/href="(\/[^"?#]*\/)"/g)) {
        if (href && !depth.has(href) && htmlOf(href) !== undefined) {
          depth.set(href, (depth.get(path) ?? 0) + 1);
          queue.push(href);
        }
      }
    }
    const capacityPaths = pages.map((p) => p.path).filter((p) => p.startsWith("/kapaciteti/"));
    expect(capacityPaths.filter((p) => !depth.has(p))).toEqual([]);
    expect(Math.max(...capacityPaths.map((p) => depth.get(p) ?? 99))).toBeLessThanOrEqual(3);
  });

  it("appear in the navigation, llms.txt and the API index", () => {
    expect(html("/o-karti/")).toMatch(/<a href="\/kapaciteti\/"><svg[^]*?<\/svg>Kapaciteti<\/a>/);
    expect(llmsTxt(site)).toContain("(https://karta.example/en/grid-capacity/)");
    const index = JSON.parse(apiFiles(site).get("api/index.json") ?? "{}") as {
      capacity?: { current: string };
    };
    expect(index.capacity?.current).toBe("https://podaci.example/hep/current.json");
  });

  it("keep slugs unique when two names slug alike", () => {
    const twin = {
      ...RELEASE.stations[0],
      id: "TS 110/35 kV 4TS 117 JERTOVEC",
    } as (typeof RELEASE.stations)[number];
    const slugs = stationSlugs({ ...RELEASE, stations: [...RELEASE.stations, twin] });
    expect(slugs.get("TS 110/35 kV 4TS 117 JERTOVEC")).toBe("ts-110-35-kv-4ts-117-jertovec");
    const clash = { ...twin, id: "TS 110-35kV 4TS 117 JERTOVEC" };
    const both = stationSlugs({ ...RELEASE, stations: [...RELEASE.stations, clash] });
    expect(new Set(both.values()).size).toBe(both.size);
  });
});

describe("links between HEP and the map's substations", () => {
  const linked: SiteData = {
    ...site,
    index: {
      ...site.index,
      rows: [
        ["osm:way/1", "TS Pokupje", "substations", "HR", 15.5521, 45.5359, "110"], // ~30 m from HEP's POKUPJE
        ["osm:way/2", "TS Pehlin", "substations", "HR", 14.4099, 45.3551, "220"], // ~45 m from HEP's PEHLIN
      ],
    },
  };
  const linkedPages = buildPages(linked);
  const linkedPage = (path: string): StaticPage => {
    const found = linkedPages.find((p) => p.path === path);
    if (!found) throw new Error(`no page ${path}`);
    return found;
  };

  it("show the OSM substation on a HEP page: its own page when it has one, the map otherwise", () => {
    const pehlin = renderPage(linkedPage("/kapaciteti/ts-220-110-35kv-pehlin/"), linked);
    expect(pehlin).toContain('<dt>Na karti</dt><dd><a href="/objekt/osm-way-2/">TS Pehlin</a></dd>');
    const pokupje = renderPage(linkedPage("/kapaciteti/ts-110-35kv-pokupje/"), linked);
    expect(pokupje).toContain(
      '<dt>Na karti</dt><dd><a href="/?sel=osm%3Away%2F1&amp;v=45.5359%2C15.5521%2C12">TS Pokupje</a></dd>',
    );
  });

  it("show HEP's capacity on the OSM substation's own page", () => {
    const asset = linkedPage("/objekt/osm-way-2/");
    const section = asset.sections.find((s) => s.heading === "Slobodni kapacitet za priključenje (HEP ODS)");
    // 82 511 kW free; power() rounds to whole MW from 10 MW up
    expect(section?.html).toContain("Prema HEP ODS-u: D: više od 20 MW, slobodno 83 MW.");
    expect(section?.html).toContain('<a href="/kapaciteti/ts-220-110-35kv-pehlin/">');
    expect(
      buildPages({ ...linked, capacity: null })
        .find((p) => p.path === "/objekt/osm-way-2/")
        ?.sections.some((s) => s.heading.includes("HEP")),
    ).toBe(false);
  });
});
