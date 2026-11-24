import { describe, expect, it } from "vitest";

import { planeOf, planesKey, planeShare, RoofPlanesSchema } from "./roofPlanes";
import { PLANES } from "./roofPlanes.fixture";

describe("the roof planes of a grid point", () => {
  it("are read from one small file per point, as the pipeline writes it", () => {
    expect(planesKey({ col: 10, row: 9 })).toBe("solar/planes/10-9.json");
    expect(RoofPlanesSchema.parse(PLANES)).toEqual(PLANES);
    expect(() => RoofPlanesSchema.parse({ ...PLANES, planes: [] })).toThrow();
  });

  it("find a direction at a tilt, and a flat roof whatever the tilt", () => {
    expect(planeOf(PLANES, "E", 30)?.id).toBe("E-30");
    expect(planeOf(PLANES, "flat", 45)?.id).toBe("flat");
    expect(planeOf(PLANES, "W", 30)).toBeNull();
  });

  it("give what a plane makes of the best plane's output, never more than all of it", () => {
    const east = planeOf(PLANES, "E", 30);
    const steep = planeOf(PLANES, "S", 45);
    expect(east && planeShare(PLANES, east)).toBe(0.8);
    // PVGIS rounds the best angles to whole degrees: a neighbour can come out a hair above
    expect(steep && planeShare(PLANES, steep)).toBe(1);
  });
});
