import { describe, expect, it } from "vitest";

import { defined } from "../test/defined";
import { activeSteps, CASCADE, geothermalFeatures, totals } from "./geothermal";
import { SAMPLE_GEOTHERMAL } from "./geothermal.fixture";

const DOC = SAMPLE_GEOTHERMAL;

describe("geothermal", () => {
  it("adds up what runs today and what is coming", () => {
    expect(totals(DOC)).toEqual({
      operatingMw: 16.5,
      plannedMw: 98,
      heatSites: 1,
      confirmed: 1,
      developing: 1,
    });
  });

  it("turns cells into squares around their centre and sites into points", () => {
    const fc = geothermalFeatures(DOC);
    const cell = fc.features.find((f) => f.geometry.type === "Polygon");
    expect(cell?.properties).toEqual({ q: 92 });
    expect(cell?.geometry.type === "Polygon" && cell.geometry.coordinates[0]?.[0]).toEqual([16, 45.8]);
    expect(fc.features.filter((f) => f.geometry.type === "Point").map((f) => f.id)).toEqual(
      DOC.sites.map((s) => s.id),
    );
  });

  it("works without a heat-flow grid", () => {
    expect(geothermalFeatures({ ...DOC, heatFlow: null }).features).toHaveLength(DOC.sites.length);
  });

  it("marks the cascade steps a site really uses", () => {
    const topusko = defined(DOC.sites[2]);
    expect([...activeSteps(topusko)].sort()).toEqual(["heating", "return", "spa", "well"]);
    expect(CASCADE.map((s) => s.use)).toEqual([
      "well",
      "electricity",
      "heating",
      "greenhouses",
      "spa",
      "return",
    ]);
  });
});
