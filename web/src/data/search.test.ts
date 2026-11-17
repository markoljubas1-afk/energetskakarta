import { describe, expect, it } from "vitest";

import { normalize, prepareIndex, search, SearchIndexSchema, toHit, type SearchIndex } from "./search";

const index: SearchIndex = SearchIndexSchema.parse({
  version: 1,
  fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
  rows: [
    ["osm:way/1", "HE Dubrovnik", "plants", "HR", 18.1, 42.6, "hydro|252"],
    ["osm:node/2", "TS Žerjavinec", "substations", "HR", 15.95, 45.55, "400"],
    ["osm:node/3", "Đurđenovac", "plants", "HR", 18, 45.5, "biomass|"],
    ["osm:node/4", "Stari Dubrovnik solar", "plants", "XX", 18, 42.6, "solar|0.5"],
    ["osm:node/5", "TS Nepoznata", "substations", "SI", 14, 46, ""],
    ["osm:node/6", "Elektrana Zagreb", "plants", "HR", 16, 45.8, "gas|100"],
    ["osm:node/7", "Zagreb TE-TO", "plants", "HR", 16, 45.8, "gas|440"],
  ],
});
const prepared = prepareIndex(index);

describe("normalize", () => {
  it("folds case and diacritics, including đ", () => {
    expect(normalize("  ŽERJAVINEC ")).toBe("zerjavinec");
    expect(normalize("Đurđenovac")).toBe("durdenovac");
  });
});

describe("search", () => {
  it("needs at least two characters", () => {
    expect(search(prepared, "d")).toEqual([]);
  });

  it("ranks prefix matches before substring matches, otherwise keeps index order", () => {
    expect(search(prepared, "zagreb").map((hit) => hit.id)).toEqual(["osm:node/7", "osm:node/6"]);
    expect(search(prepared, "dubrovnik").map((hit) => hit.id)).toEqual(["osm:way/1", "osm:node/4"]);
  });

  it("finds names without typing diacritics", () => {
    expect(search(prepared, "zerjav")[0]).toMatchObject({
      kind: "substation",
      name: "TS Žerjavinec",
      maxVoltageKv: 400,
    });
    expect(search(prepared, "durd")[0]).toMatchObject({
      kind: "plant",
      technology: "biomass",
      capacityMw: null,
    });
  });

  it("maps unknown countries to null and parses details", () => {
    const [hit] = search(prepared, "stari");
    expect(hit).toMatchObject({ kind: "plant", country: null, technology: "solar", capacityMw: 0.5 });
    expect(search(prepared, "nepoznata")[0]).toMatchObject({ kind: "substation", maxVoltageKv: null });
  });

  it("knows a result that is a new part of a running plant, which the source names alike", () => {
    expect(
      toHit(["gem:L1:planned", "NE Primjer", "plants", "SI", 15.5, 45.9, "nuclear|1100|planned"]),
    ).toMatchObject({
      kind: "plant",
      capacityMw: 1100,
      expansion: "planned",
    });
    expect(
      toHit(["gem:L2:construction", "TE Primjer", "plants", "HU", 19, 47, "gas|500|construction"]),
    ).toMatchObject({
      expansion: "construction",
    });
    // an ordinary plant, and an index from before the mark existed
    expect(toHit(["osm:way/1", "HE Dubrovnik", "plants", "HR", 18.1, 42.6, "hydro|252"])).toMatchObject({
      expansion: null,
    });
    expect(toHit(["osm:way/2", "X", "plants", "HR", 18, 42, "hydro|1|operating"])).toMatchObject({
      expansion: null,
    });
  });

  it("respects the limit", () => {
    expect(search(prepared, "ts", 1)).toHaveLength(1);
  });
});
