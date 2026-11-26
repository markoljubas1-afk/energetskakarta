import { describe, expect, it } from "vitest";

import { MAX_REDIRECTS, movedPages, redirectsFile } from "./moved";
import type { SeoManifest } from "./prerender";
import type { AssetRecord } from "./records";

const record = (sources: AssetRecord["sources"]): AssetRecord => ({
  status: "operating",
  operator: null,
  commissioningYear: null,
  voltagesKv: [],
  wikidata: null,
  wikipedia: null,
  sources,
});
const osm = { source: "openstreetmap", sourceId: "way/7", license: "ODbL-1.0", url: null };
const gem = { source: "gem", sourceId: "L100000000007:operating", license: "CC-BY-4.0", url: null };

const OLD_HR = "/objekt/gem-L100000000007-operating/";
const OLD_EN = "/en/asset/gem-L100000000007-operating/";
const NEW_HR = "/objekt/osm-way-7/";
const NEW_EN = "/en/asset/osm-way-7/";

const manifest = (pages: string[], moved?: Record<string, string>): SeoManifest => ({
  version: 1,
  buildId: "before",
  pages: Object.fromEntries(pages.map((p) => [p, { hash: "h", lastmod: "2026-11-23" }])),
  ...(moved ? { moved } : {}),
});

describe("movedPages: a GEM record merged into an OSM plant keeps its address (provjera spajanja)", () => {
  const records = new Map([["osm:way/7", record([osm, gem])]]);
  const current = new Set([NEW_HR, NEW_EN]);

  it("sends the published page of the GEM record to the plant it is now part of, in both languages", () => {
    const moved = movedPages(records, current, manifest([OLD_HR, OLD_EN]));
    expect(moved).toEqual({ [OLD_HR]: NEW_HR, [OLD_EN]: NEW_EN });
  });

  it("only for pages that were published: a merge that never had a page needs no redirect", () => {
    expect(movedPages(records, current, manifest([]))).toEqual({});
    expect(movedPages(records, current, null)).toEqual({});
  });

  it("keeps the redirects of earlier releases while their target still has a page", () => {
    const earlier = {
      "/objekt/gem-L100000000001-operating/": NEW_HR,
      "/objekt/gem-L1-gone/": "/objekt/gone/",
    };
    const moved = movedPages(new Map(), current, manifest([], earlier));
    expect(moved).toEqual({ "/objekt/gem-L100000000001-operating/": NEW_HR });
  });

  it("never redirects a page that this release publishes again", () => {
    const back = new Set([...current, OLD_HR]);
    expect(movedPages(records, back, manifest([OLD_HR], { [OLD_HR]: NEW_HR }))).toEqual({});
  });

  it("leaves a GEM-only record alone: its page is its own", () => {
    const gemOnly = new Map([["gem:L100000000007:operating", record([gem])]]);
    expect(movedPages(gemOnly, new Set([OLD_HR]), manifest([OLD_HR]))).toEqual({});
  });
});

describe("redirectsFile", () => {
  it("writes Cloudflare Pages' _redirects, one permanent redirect a line, in a stable order", () => {
    expect(redirectsFile({ [OLD_HR]: NEW_HR, [OLD_EN]: NEW_EN })).toBe(
      `${OLD_EN} ${NEW_EN} 301\n${OLD_HR} ${NEW_HR} 301\n`,
    );
  });

  it("says so, with numbers, before Cloudflare would ignore the lines past its limit", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_REDIRECTS + 1 }, (_, i) => [`/objekt/gem-${String(i)}/`, NEW_HR]),
    );
    expect(() => redirectsFile(many)).toThrow(String(MAX_REDIRECTS));
  });
});
