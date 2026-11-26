import { describe, expect, it } from "vitest";

import type { SearchIndex } from "../data/search";
import { learnPage } from "./learnPages";
import type { AssetRecord } from "./records";
import { bareSite } from "./site.fixture";
import { operatingPlants, topPlantsSection } from "./topPlants";

const record = (status: AssetRecord["status"], commissioningYear: number | null = null): AssetRecord => ({
  status,
  operator: null,
  commissioningYear,
  voltagesKv: [],
  wikidata: null,
  wikipedia: null,
  sources: [],
});

const index: SearchIndex = {
  version: 1,
  fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
  rows: [
    ["osm:way/1", "HE Zakučac", "plants", "HR", 16.7, 43.4, "hydro|576"],
    ["osm:way/2", "TE Plomin", "plants", "HR", 14.2, 45.1, "coal|210"],
    ["osm:way/3", "VE Senj", "plants", "HR", 14.9, 45.0, "wind|156"],
    ["osm:way/4", "SE Obrovac", "plants", "HR", 15.7, 44.2, "solar|9"],
    ["osm:way/5", "SE Velika u gradnji", "plants", "HR", 15.0, 44.0, "solar|99|construction"],
    ["osm:way/6", "HE Bez zapisa", "plants", "HR", 15.0, 44.0, "hydro|700"],
    ["osm:way/7", "NE Krško", "plants", "SI", 15.5, 45.9, "nuclear|696"],
    ["osm:way/8", "HE Bez snage", "plants", "HR", 15.0, 44.0, "hydro|"],
  ],
};

const records = new Map<string, AssetRecord>([
  ["osm:way/1", record("operating", 1961)],
  ["osm:way/2", record("operating", 2000)],
  ["osm:way/3", record("operating")],
  ["osm:way/4", record("operating", 2021)],
  ["osm:way/5", record("construction")],
  ["osm:way/7", record("operating", 1983)],
  ["osm:way/8", record("operating")],
]);

describe("the largest plants of Croatia", () => {
  it("lists only Croatia's plants in operation with a recorded capacity, largest first", () => {
    const site = bareSite({ index, records });
    expect(operatingPlants(site).map((plant) => plant.name)).toEqual([
      "HE Zakučac",
      "TE Plomin",
      "VE Senj",
      "SE Obrovac",
    ]);
  });

  it("puts the largest solar and wind plant beside the list, compared with the largest plant", () => {
    const section = topPlantsSection(bareSite({ index, records }), "hr");
    expect(section?.heading).toBe("Deset najvećih elektrana u Hrvatskoj");
    const html = section?.html ?? "";
    expect(html).toContain("4 elektrana u pogonu s najvećom zabilježenom snagom; zajedno imaju 951 MW.");
    expect(html).toMatch(
      /<a href="\/[^"]+">HE Zakučac<\/a><\/th><td>Hidro<\/td><td class="num">576 MW<\/td><td class="num">1961<\/td>/,
    );
    // a year the record does not have is a dash, not a guess
    expect(html).toMatch(
      /VE Senj<\/a><\/th><td>Vjetar<\/td><td class="num">156 MW<\/td><td class="num">—<\/td>/,
    );
    // a plant under the page threshold has no page to link to
    expect(html).toContain("Najveća sunčana elektrana u pogonu: SE Obrovac, 9 MW.");
    expect(html).toContain(
      "Najveća elektrana na popisu (HE Zakučac) ima 64 puta veću snagu od najveće sunčane elektrane.",
    );
    expect(html).toContain("ima 3,7 puta veću snagu od najveće vjetroelektrane.");
    expect(html).toContain("Snaga nije proizvodnja");
    expect(html).not.toContain("u gradnji");
    expect(html).not.toContain("Krško");
  });

  it("is a section of the learning corner only when the release knows what is in operation", () => {
    const withList = learnPage(bareSite({ index, records }), "en");
    expect(withList.sections.map((section) => section.heading)).toContain(
      "The ten largest power plants in Croatia",
    );
    const without = learnPage(bareSite({ index }), "en");
    expect(without.sections.map((section) => section.heading)).not.toContain(
      "The ten largest power plants in Croatia",
    );
    expect(topPlantsSection(bareSite(), "hr")).toBeNull();
  });
});
