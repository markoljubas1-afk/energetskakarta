import { describe, expect, it } from "vitest";

import { PlantGridSchema, summarizeView, type PlantGrid } from "./plantGrid";

const GRID: PlantGrid = {
  version: 1,
  cellDeg: 0.25,
  fields: ["lon", "lat", "technology", "status", "count", "withCapacity", "capacityMw"],
  rows: [
    [16.5, 45.75, "pumped_storage", "operating", 1, 1, 276],
    [16.5, 45.75, "solar", "planned", 2, 1, 9.9],
    [16.0, 45.75, "gas", "operating", 3, 2, 500],
    [13.75, 45.0, "coal", "operating", 1, 1, 210], // Plomin: far from the views below
    [16.0, 45.75, "tidal", "operating", 1, 1, 5], // a technology this site does not know is not counted
  ],
};

describe("plant grid", () => {
  it("is what the pipeline writes", () => {
    expect(PlantGridSchema.parse(GRID)).toEqual(GRID);
    expect(() => PlantGridSchema.parse({ ...GRID, version: 2 })).toThrow();
  });

  it("adds up the cells the view touches, technology by technology", () => {
    const view = summarizeView(GRID, [15.9, 45.7, 16.8, 46.0]);
    expect(view.operatingMw).toBe(776);
    expect(view.pipelineMw).toBe(9.9);
    expect(view.technologies.map((row) => row.technology)).toEqual(["gas", "pumped_storage", "solar"]);
    const solar = view.technologies.find((row) => row.technology === "solar");
    expect(solar).toMatchObject({ plants: 2, operatingPlants: 0, plantsWithoutCapacity: 1, pipelineMw: 9.9 });
    const gas = view.technologies.find((row) => row.technology === "gas");
    expect(gas).toMatchObject({ plants: 3, operatingPlants: 3, plantsWithoutCapacity: 1, operatingMw: 500 });
  });

  it("counts a cell whole as soon as the view touches it, and not at all when it only meets its edge", () => {
    // the view's west edge lies inside the cell 16.5–16.75
    expect(summarizeView(GRID, [16.7, 45.8, 17.5, 46.5]).operatingMw).toBe(276);
    // the view starts exactly where the cell ends
    expect(summarizeView(GRID, [16.75, 45.8, 17.5, 46.5]).technologies).toEqual([]);
  });

  it("is empty where there is nothing", () => {
    expect(summarizeView(GRID, [20, 40, 21, 41])).toEqual({
      technologies: [],
      operatingMw: 0,
      pipelineMw: 0,
    });
  });
});
