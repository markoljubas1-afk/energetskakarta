import { describe, expect, it } from "vitest";

import { fromProperties } from "./selection";

describe("fromProperties", () => {
  it("reads a line, including multi-voltage and countries", () => {
    expect(
      fromProperties("lines", {
        id: "osm:way/100",
        status: "operating",
        kind: "line",
        maxVoltageKv: 400,
        voltages: "400;220",
        circuits: 2,
        isHvdc: false,
        isInterconnector: true,
        countries: "HR,SI",
        operator: "HOPS; ELES",
      }),
    ).toEqual({
      id: "osm:way/100",
      status: "operating",
      operator: "HOPS; ELES",
      sources: ["openstreetmap"],
      gemUrl: null,
      kind: "line",
      voltagesKv: [400, 220],
      maxVoltageKv: 400,
      circuits: 2,
      isHvdc: false,
      isInterconnector: true,
      countries: ["HR", "SI"],
    });
  });

  it("reads a plant and falls back for unknown technologies and missing values", () => {
    expect(
      fromProperties("plants", { id: "osm:node/1", status: "planned", technology: "fusion", country: "HR" }),
    ).toEqual({
      id: "osm:node/1",
      status: "planned",
      operator: null,
      sources: ["openstreetmap"],
      gemUrl: null,
      kind: "plant",
      name: null,
      technology: "other",
      capacityMw: null,
      commissioningYear: null,
      country: "HR",
    });
  });

  it("reads a substation", () => {
    expect(
      fromProperties("substations", {
        id: "osm:way/108",
        status: "construction",
        name: "TS",
        voltages: "110",
      }),
    ).toMatchObject({ kind: "substation", name: "TS", voltagesKv: [110], maxVoltageKv: null });
  });

  it.each([
    ["lines", { status: "operating" }],
    ["plants", { id: "osm:node/1", status: "demolished" }],
    ["countries", { id: "osm:node/1", status: "operating" }],
  ])("rejects incomplete or foreign features (%s)", (layer, props) => {
    expect(fromProperties(layer, props)).toBeNull();
  });

  it("reads merged sources and only trusts https GEM links", () => {
    const merged = fromProperties("plants", {
      id: "osm:way/109",
      status: "operating",
      technology: "pumped_storage",
      sources: "gem,openstreetmap,unknown",
      gemUrl: "https://www.gem.wiki/RHE_Primjer",
    });
    expect(merged).toMatchObject({
      sources: ["gem", "openstreetmap"],
      gemUrl: "https://www.gem.wiki/RHE_Primjer",
    });

    const unsafe = fromProperties("plants", {
      id: "gem:L100000000004:operating",
      status: "operating",
      sources: "gem",
      gemUrl: "javascript:alert(1)",
    });
    expect(unsafe).toMatchObject({ gemUrl: null, sources: ["gem"] });
  });

  it("reads an offshore pipeline", () => {
    expect(
      fromProperties("pipelines", {
        id: "emodnet:pipelines/101",
        sources: "emodnet",
        status: "operating",
        name: "Plinovod Primjer",
        medium: "gas",
        diameterIn: 12,
        lengthKm: 76,
        commissioningYear: 2006,
        countries: "HR,IT",
        operator: "INA",
      }),
    ).toEqual({
      id: "emodnet:pipelines/101",
      status: "operating",
      operator: "INA",
      sources: ["emodnet"],
      gemUrl: null,
      kind: "pipeline",
      name: "Plinovod Primjer",
      medium: "gas",
      diameterIn: 12,
      lengthKm: 76,
      commissioningYear: 2006,
      countries: ["HR", "IT"],
    });
    expect(
      fromProperties("pipelines", { id: "emodnet:pipelines/9", status: "planned", medium: "steam" }),
    ).toMatchObject({
      medium: "unknown",
      countries: [],
    });
  });
});

describe("cities", () => {
  it("reads a city with its sectors from the tile's JSON string", () => {
    const city = fromProperties("cities", {
      id: "com:1001",
      name: "Grad Primjer",
      country: "HR",
      population: 121000,
      inventoryYear: 2019,
      baseline: false,
      electricityMwh: 186500,
      totalMwh: 204500,
      baselineYear: 2011,
      baselineElectricityMwh: 175000,
      sectors: '{"public_lighting":{"e":6500,"t":6500},"nonsense":{"e":1,"t":1},"industry":"x"}',
    });
    expect(city).toMatchObject({ kind: "city", name: "Grad Primjer", sources: ["com"] });
    expect(city?.kind === "city" ? city.sectors : null).toEqual({
      public_lighting: { electricityMwh: 6500, totalMwh: 6500 },
    });
    // a broken sector string is not a broken city
    expect(
      fromProperties("cities", {
        id: "com:2",
        name: "X",
        inventoryYear: 2019,
        electricityMwh: 1,
        totalMwh: 1,
        sectors: "{",
      }),
    ).toMatchObject({ sectors: {} });
    expect(
      fromProperties("cities", { id: "com:3", inventoryYear: 2019, electricityMwh: 1, totalMwh: 1 }),
    ).toBeNull();
  });
});
