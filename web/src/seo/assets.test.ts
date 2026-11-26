import { describe, expect, it } from "vitest";

import type { Current } from "../data/current";
import type { SearchIndex } from "../data/search";
import { NEARBY } from "./assetFacts";
import { buildPages, type SiteData, type StaticPage } from "./pages";
import { parseSeoManifest, SEO_MANIFEST, staticFiles } from "./prerender";
import { MAX_BROKEN_SHARE, parseRecords, wikipediaUrl, type AssetRecord } from "./records";
import { SAMPLE_CURRENT } from "./site.fixture";

const feature = (properties: Record<string, unknown>): string =>
  JSON.stringify({ type: "Feature", geometry: { type: "Point", coordinates: [16, 45] }, properties });

const provenance = [
  {
    source: "openstreetmap",
    sourceId: "way/2",
    license: "ODbL-1.0",
    retrievedAt: "2026-11-08T00:00:00Z",
    url: null,
  },
  {
    source: "gem",
    sourceId: "L100000000002",
    license: "CC-BY-4.0",
    retrievedAt: "2026-11-08T00:00:00Z",
    url: "https://www.gem.wiki/HE_Velika",
  },
];

describe("parseRecords", () => {
  it("keeps the wanted assets with what the pages need and skips the rest", () => {
    const ndjson = [
      feature({
        id: "osm:way/2",
        status: "operating",
        operator: "HEP Proizvodnja",
        commissioningYear: 1962,
        wikidata: "Q12345",
        wikipedia: "hr:HE Velika",
        provenance,
      }),
      feature({ id: "osm:way/999", status: "operating", provenance }),
      "",
    ].join("\n");
    const records = parseRecords(ndjson, new Set(["osm:way/2"]));
    expect([...records.keys()]).toEqual(["osm:way/2"]);
    expect(records.get("osm:way/2")).toEqual({
      status: "operating",
      operator: "HEP Proizvodnja",
      commissioningYear: 1962,
      voltagesKv: [],
      wikidata: "Q12345",
      wikipedia: "hr:HE Velika",
      sources: [
        { source: "openstreetmap", sourceId: "way/2", license: "ODbL-1.0", url: null },
        {
          source: "gem",
          sourceId: "L100000000002",
          license: "CC-BY-4.0",
          url: "https://www.gem.wiki/HE_Velika",
        },
      ],
    } satisfies AssetRecord);
  });

  it("tolerates the odd broken line but stops on a broken file", () => {
    const good = Array.from({ length: 200 }, (_, i) => feature({ id: `osm:node/${i}`, provenance }));
    expect(parseRecords([...good, "{not json"].join("\n"), new Set(["osm:node/1"])).size).toBe(1);
    const broken = Array.from({ length: Math.ceil(200 * MAX_BROKEN_SHARE) + 2 }, () => "<html>");
    expect(() => parseRecords([...good, ...broken].join("\n"), new Set())).toThrow("broken");
  });

  it("turns a Wikipedia title into its address", () => {
    expect(wikipediaUrl("hr:HE Zakučac")).toBe("https://hr.wikipedia.org/wiki/HE_Zaku%C4%8Dac");
    expect(wikipediaUrl("Zakučac")).toBeNull();
  });
});

const current: Current = {
  ...SAMPLE_CURRENT,
  buildId: "20261108T060000Z",
  createdAt: "2026-11-08T06:00:00+00:00",
  counts: { lines: 1, substations: 1, plants: 3 },
};

const bare: AssetRecord = {
  status: null,
  operator: null,
  commissioningYear: null,
  voltagesKv: [],
  wikidata: null,
  wikipedia: null,
  sources: [],
};

const index: SearchIndex = {
  version: 1,
  fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
  rows: [
    ["osm:way/1", "HE Najveća", "plants", "HR", 16.5, 45.5, "hydro|400"],
    ["osm:way/2", "HE Velika", "plants", "HR", 16.2, 45.2, "hydro|276"],
    ["osm:way/3", "HE Mala", "plants", "HR", 16.21, 45.21, "hydro|40"],
    ["osm:way/4", "Baterija", "plants", "HR", 15.0, 44.0, "battery|20"],
    ["osm:node/50", "TS Blizu", "substations", "HR", 16.25, 45.2, "400"],
  ],
};

const site: SiteData = {
  siteUrl: "https://karta.example",
  dataBaseUrl: "https://podaci.example/",
  current,
  stats: {
    version: 1,
    voltageClasses: [],
    note: "",
    plants: { HR: { hydro: { operating: { count: 3, capacityMw: 716, withCapacity: 3 } } } },
    substations: {},
    lineKm: {},
  },
  index,
  cities: null,
  diff: null,
  records: new Map<string, AssetRecord>([
    [
      "osm:way/2",
      {
        status: "operating",
        operator: "HEP Proizvodnja",
        commissioningYear: 1962,
        voltagesKv: [],
        wikidata: "Q12345",
        wikipedia: "hr:HE Velika",
        sources: [
          { source: "openstreetmap", sourceId: "way/2", license: "ODbL-1.0", url: null },
          {
            source: "gem",
            sourceId: "L100000000002",
            license: "CC-BY-4.0",
            url: "https://www.gem.wiki/HE_Velika",
          },
        ],
      },
    ],
    [
      "osm:node/50",
      {
        status: "operating",
        operator: null,
        commissioningYear: null,
        voltagesKv: [400, 220, 110],
        wikidata: null,
        wikipedia: null,
        sources: [],
      },
    ],
    // HE Najveća (400 MW) is only planned; HE Mala and the battery run (Faza 31: rankings count those only)
    ["osm:way/1", { ...bare, status: "planned" }],
    ["osm:way/3", { ...bare, status: "operating" }],
    ["osm:way/4", { ...bare, status: "operating" }],
  ]),
};
const pages = buildPages(site);
const page = (path: string): StaticPage => {
  const found = pages.find((p) => p.path === path);
  if (!found) throw new Error(`no page ${path}`);
  return found;
};
const facts = (path: string): string => page(path).sections[0]?.html ?? "";

describe("asset pages with the complete record", () => {
  it("show status, operator, year, voltages and sources with their licences", () => {
    const plant = facts("/objekt/osm-way-2/");
    expect(plant).toContain("<dt>Status</dt><dd>U pogonu</dd>");
    expect(plant).toContain("<dt>Operator</dt><dd>HEP Proizvodnja</dd>");
    expect(plant).toContain("<dt>Godina puštanja u pogon</dt><dd>1962</dd>");
    expect(plant).toContain(
      '<dt>Izvori i licence</dt><dd>OpenStreetMap (ODbL-1.0), <a href="https://www.gem.wiki/HE_Velika" rel="noopener">Global Energy Monitor</a> (CC-BY-4.0)</dd>',
    );
    expect(facts("/objekt/osm-node-50/")).toContain("<dt>Naponi</dt><dd>400 / 220 / 110 kV</dd>");
  });

  it("say where the plant ranks and what share of the country it is", () => {
    // 400 (planned), 276 and 40 MW of hydro in Croatia: among the operating ones HE Velika is the largest;
    // 276 / 716 MW operating = 38.5 %
    expect(page("/objekt/osm-way-2/").lead).toContain(
      "<p>Najveća hidroelektrana u pogonu u Hrvatskoj po upisanoj snazi (od 2 u pogonu s upisanom snagom).</p>",
    );
    expect(page("/objekt/osm-way-3/").lead).toContain(
      "<p>2. najveća hidroelektrana u pogonu u Hrvatskoj po upisanoj snazi (od 2 u pogonu s upisanom snagom).</p>",
    );
    // a planned plant is not ranked against the ones that run
    expect(page("/objekt/osm-way-1/").lead).not.toContain("najveća");
    expect(page("/objekt/osm-way-2/").lead).toMatch(
      /To je 38,5\s%\ssnage u pogonu zabilježene u Hrvatskoj\./,
    );
    expect(page("/en/asset/osm-way-3/").lead).toContain(
      "The 2nd largest operating hydropower plant in Croatia by recorded capacity (of 2 operating with a recorded capacity).",
    );
    // the adjective agrees in Croatian; the only one of its kind is simply "the largest"
    expect(page("/objekt/osm-way-4/").lead).toContain(
      "Najveći baterijski spremnik u pogonu u Hrvatskoj po upisanoj snazi.",
    );
    // without a record (status unknown) there is no share sentence
    expect(page("/objekt/osm-way-1/").lead).not.toContain("snage u pogonu");
  });

  it("link Wikidata and Wikipedia and name them as the same thing", () => {
    const plant = page("/objekt/osm-way-2/");
    const links = plant.sections.find((s) => s.heading === "Karta")?.html ?? "";
    expect(links).toContain(
      '<a href="https://www.wikidata.org/wiki/Q12345" rel="noopener">Wikidata: Q12345</a>',
    );
    expect(links).toContain(
      '<a href="https://hr.wikipedia.org/wiki/HE_Velika" rel="noopener">Wikipedia (hr)</a>',
    );
    expect(plant.jsonLd[0]).toMatchObject({
      sameAs: [
        "https://www.openstreetmap.org/way/2",
        "https://www.wikidata.org/wiki/Q12345",
        "https://hr.wikipedia.org/wiki/HE_Velika",
      ],
    });
  });

  it("list the nearest assets with a page, nearest first", () => {
    const near = page("/objekt/osm-way-2/").sections.find((s) => s.heading === "U blizini")?.html ?? "";
    // HE Mala ~1.4 km, TS Blizu ~3.9 km, HE Najveća ~41 km; the battery is beyond 50 km
    expect(near.indexOf("HE Mala")).toBeLessThan(near.indexOf("TS Blizu"));
    expect(near).toContain('<a href="/objekt/osm-way-3/">HE Mala</a> (elektrana, 1,4 km)');
    expect(near).not.toContain("Baterija");
    expect((near.match(/<li>/g) ?? []).length).toBeLessThanOrEqual(NEARBY);
  });
});

describe("a GEM record merged into an OSM plant (provjera spajanja)", () => {
  // HE Velika (osm:way/2) carries GEM's L100000000002, which had a page of its own before the merge
  const previous = {
    version: 1 as const,
    buildId: "before",
    pages: {
      "/objekt/gem-L100000000002/": { hash: "h", lastmod: "2026-11-23" },
      "/en/asset/gem-L100000000002/": { hash: "h", lastmod: "2026-11-23" },
    },
  };

  it("sends the old page on to the plant's and remembers it for the next release", () => {
    const files = staticFiles(site, undefined, { previous });
    expect(files.get("_redirects")).toBe(
      [
        "/en/asset/gem-L100000000002/ /en/asset/osm-way-2/ 301",
        "/objekt/gem-L100000000002/ /objekt/osm-way-2/ 301",
        "",
      ].join("\n"),
    );
    const manifest = parseSeoManifest(JSON.parse(files.get(SEO_MANIFEST) ?? "null"));
    expect(manifest?.moved?.["/objekt/gem-L100000000002/"]).toBe("/objekt/osm-way-2/");
    // a later release still redirects, from the manifest alone
    const later = staticFiles(site, undefined, { previous: manifest });
    expect(later.get("_redirects")).toContain("/objekt/gem-L100000000002/ /objekt/osm-way-2/ 301");
  });

  it("writes no _redirects when nothing moved", () => {
    expect(staticFiles(site).has("_redirects")).toBe(false);
  });
});
