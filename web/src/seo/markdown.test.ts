import { describe, expect, it } from "vitest";

import { headersFile } from "../../vite/securityHeaders";
import type { Current } from "../data/current";
import { HISTORY, RELEASE } from "../data/hep.fixture";
import type { SearchIndex } from "../data/search";
import { renderPage } from "./html";
import { blocks, inline, llmsFull, pageMarkdown } from "./markdown";
import { buildPages, type SiteData } from "./pages";
import { staticFiles } from "./prerender";
import { llmsTxt } from "./sitemap";
import { SAMPLE_CURRENT } from "./site.fixture";
import { readTemplate } from "../test/template";

const current: Current = {
  ...SAMPLE_CURRENT,
  buildId: "20261108T060000Z",
  createdAt: "2026-11-08T06:00:00+00:00",
  counts: { lines: 1, substations: 1, plants: 2 },
};
const index: SearchIndex = {
  version: 1,
  fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
  rows: [
    ["osm:way/2", "HE Velika & <Co>", "plants", "HR", 16.2, 45.2, "hydro|276"],
    ["osm:node/50", "TS Žerjavinec", "substations", "HR", 15.95, 45.55, "400"],
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
    plants: { HR: { hydro: { operating: { count: 1, capacityMw: 276, withCapacity: 1 } } } },
    substations: { HR: { "380+": 1 } },
    lineKm: {},
  },
  index,
  cities: null,
  diff: null,
  capacity: RELEASE,
  capacityHistory: HISTORY,
};

describe("Markdown twins", () => {
  it("convert the generators' HTML: links absolute, tables, lists, definitions, code", () => {
    expect(inline('<a href="/zemlja/hr/">Hrvatska</a> &amp; <code>x</code>', "https://k.example")).toBe(
      "[Hrvatska](https://k.example/zemlja/hr/) & `x`",
    );
    expect(
      blocks(
        '<p>Uvod</p><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1|2</td><td class="num">3</td></tr></tbody></table><ul><li>x</li><li>y</li></ul><dl><dt>Status</dt><dd>U pogonu</dd></dl><pre><code>curl &quot;a&quot;</code></pre>',
        null,
      ),
    ).toBe(
      'Uvod\n\n| A | B |\n| --- | --- |\n| 1\\|2 | 3 |\n\n- x\n- y\n\n- **Status**: U pogonu\n\n```\ncurl "a"\n```',
    );
  });

  it("exist for every page, leave no HTML behind and name the page, date and licence", () => {
    const pages = buildPages(site);
    for (const page of pages) {
      const md = pageMarkdown(page, site);
      expect(md).not.toMatch(/<\/?[a-z][a-z0-9]*[\s>]/);
      expect(md.startsWith(`# ${page.heading}\n`)).toBe(true);
      expect(md).toContain(`https://karta.example${page.path}`);
    }
    const plant = pageMarkdown(
      pages.find((p) => p.path === "/objekt/osm-way-2/") ?? pages[0] ?? (undefined as never),
      site,
    );
    expect(plant).toContain("# HE Velika & <Co>"); // decoded once, as text
    expect(plant).toContain("preuzimanje u cjelini samo nekomercijalno");
  });

  it("are written next to each page, linked from its head and served as Markdown", () => {
    const template = readTemplate();
    const files = staticFiles(site, undefined, { template });
    expect(files.get("zemlja/hr/index.md")).toMatch(/^# [^\n]*Hrvatska\n/);
    expect(files.get("en/grid-capacity/index.md")).toContain(
      "| Category | Existing network | With upgrade |",
    );
    const country = buildPages(site).find((p) => p.path === "/zemlja/hr/");
    expect(country && renderPage(country, site)).toContain(
      '<link rel="alternate" type="text/markdown" href="/zemlja/hr/index.md">',
    );
    expect(headersFile("/d/")).toContain("/*.md\n  Content-Type: text/markdown; charset=utf-8");
  });

  it("put the main English pages into llms-full.txt and announce both in llms.txt", () => {
    const full = llmsFull(buildPages(site), site);
    expect(full).toContain("## About the map");
    expect(full).toMatch(/\n## [^\n]*Croatia\n/);
    expect(full).toContain("## Free capacity in the distribution grid (HEP ODS)");
    expect(full).not.toContain("## O karti");
    expect(llmsTxt(site)).toContain("https://karta.example/llms-full.txt");
    expect(llmsTxt(site)).toContain("add index.md to its address");
  });
});
