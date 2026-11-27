import { describe, expect, it } from "vitest";

import type { Periods } from "../data/energy";
import type { SearchIndex } from "../data/search";
import { krskoCountryLead, krskoPlantLead, latestKrskoYear } from "./krsko";
import { buildPages, type StaticPage } from "./pages";
import { bareSite } from "./site.fixture";

const plain = (value: string): string => value.replace(/\p{Zs}/gu, " ");

const block = (
  periods: string[],
  generation: Record<string, (number | null)[]>,
  load: number[],
  cover: number[],
) => ({
  periods,
  generation,
  consumption: {},
  load,
  coverage: { generation: cover, load: cover },
});

/** Slovenia reported 2024 and 2025 in full, 2026 in part; Croatia's load is known for 2025 only. */
const ENERGY: Periods = {
  version: 1,
  unit: "MWh",
  countries: {
    SI: {
      months: block([], {}, [], []),
      years: block(
        ["2024", "2025", "2026"],
        { nuclear: [5_500_000, 5_550_000, 4_000_000] },
        [1, 1, 1],
        [1, 1, 0.9],
      ),
    },
    HR: {
      months: block([], {}, [], []),
      years: block(
        ["2024", "2025", "2026"],
        { hydro: [1, 1, 1] },
        [18_000_000, 18_230_000, 1],
        [0.5, 1, 0.9],
      ),
    },
  },
};

describe("Croatia's half of Krško in a year", () => {
  it("is the latest year Slovenia reported in full, with Croatia's load when that was reported too", () => {
    expect(latestKrskoYear(ENERGY)).toEqual({ year: "2025", mwh: 2_775_000, share: 2_775_000 / 18_230_000 });
    const earlier = structuredClone(ENERGY);
    const si = earlier.countries.SI;
    if (!si) throw new Error("fixture without SI");
    si.years.coverage.generation = [1, 0.5, 0.9];
    // 2024: Croatia's load only half reported
    expect(latestKrskoYear(earlier)).toEqual({ year: "2024", mwh: 2_750_000, share: null });
    expect(latestKrskoYear({ ...ENERGY, countries: {} })).toBeNull();
  });
});

describe("the plant's page", () => {
  it("says who owns the plant, how it is counted and what Croatia's half was", () => {
    expect(plain(krskoPlantLead(ENERGY, "hr", "osm:way/89819245"))).toBe(
      "<p>Elektrana je u Sloveniji, a u jednakim je dijelovima u vlasništvu slovenske tvrtke GEN energija i hrvatskog HEP-a; svaki preuzima polovicu proizvedene struje. ENTSO-E i Eurostat njezinu proizvodnju vode kao slovensku, a hrvatsku polovicu kao uvoz u Hrvatsku. U 2025. hrvatska polovica bila je oko 2,78 TWh, 15,2 % potrošnje u Hrvatskoj.</p>",
    );
    expect(plain(krskoPlantLead(null, "en", "osm:way/89819245"))).toBe(
      "<p>The plant is in Slovenia and is owned in equal halves by Slovenia&#39;s GEN energija and Croatia&#39;s HEP; each takes half of the electricity it generates. ENTSO-E and Eurostat count its generation as Slovenian, and Croatia&#39;s half as an import into Croatia.</p>",
    );
  });

  it("is only Krško's: not the planned block beside it, not another plant", () => {
    expect(krskoPlantLead(ENERGY, "hr", "gem:L100000500165:planned")).toBe("");
    expect(krskoPlantLead(ENERGY, "hr", "osm:way/1")).toBe("");
  });
});

describe("the pages of Croatia and Slovenia", () => {
  it("say it in a sentence and link the plant's page when there is one", () => {
    expect(krskoCountryLead("hr", "HR", "/objekt/osm-way-89819245/")).toBe(
      '<p>Hrvatskoj pripada i polovica Nuklearne elektrane Krško u Sloveniji. ENTSO-E i Eurostat njezinu proizvodnju vode kao slovensku, a hrvatsku polovicu kao uvoz u Hrvatsku. <a href="/objekt/osm-way-89819245/">O elektrani</a></p>',
    );
    expect(krskoCountryLead("en", "SI", null)).toBe(
      "<p>Half of the Krško nuclear plant belongs to Croatia (HEP). ENTSO-E and Eurostat count all of its generation as Slovenian, and so does this site.</p>",
    );
    expect(krskoCountryLead("hr", "HU", null)).toBe("");
  });

  it("are built with it, linking the plant only when this release publishes its page", () => {
    const krsko: SearchIndex["rows"][number] = [
      "osm:way/89819245",
      "Jedrska elektrarna Krško",
      "plants",
      "SI",
      15.52,
      45.94,
      "nuclear|727",
    ];
    const lead = (pages: StaticPage[], path: string): string =>
      pages.find((p) => p.path === path)?.lead ?? "";
    const withPlant = buildPages(
      bareSite({
        energy: ENERGY,
        index: {
          version: 1,
          fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
          rows: [krsko],
        },
      }),
    );
    expect(lead(withPlant, "/zemlja/hr/")).toContain('<a href="/objekt/osm-way-89819245/">O elektrani</a>');
    expect(lead(withPlant, "/en/country/si/")).toContain(
      '<a href="/en/asset/osm-way-89819245/">About the plant</a>',
    );
    expect(lead(withPlant, "/zemlja/hu/")).not.toContain("Krško");
    const plant = withPlant.find((p) => p.path === "/objekt/osm-way-89819245/");
    expect(plain(plant?.lead ?? "")).toContain("U 2025. hrvatska polovica bila je oko 2,78 TWh");
    // without the plant in the index there is no page to link
    expect(lead(buildPages(bareSite({ energy: ENERGY })), "/zemlja/hr/")).not.toContain("<a ");
  });
});
