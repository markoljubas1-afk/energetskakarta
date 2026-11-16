import { describe, expect, it } from "vitest";

import { aroundOf, NearbySchema, type Nearby } from "./nearby";

const NEARBY: Nearby = {
  version: 1,
  plantReachKm: 2,
  lineReachKm: 0.6,
  fields: ["substation", "metres", "lines"],
  plants: { "osm:way/1": ["osm:way/10", 334, ["osm:way/20", "osm:way/21"]] },
};

describe("the grid next to a plant", () => {
  it("is what the pipeline writes", () => {
    expect(NearbySchema.parse(NEARBY)).toEqual(NEARBY);
    // an entry without lines would light a substation and nothing else: the pipeline never writes one
    expect(() =>
      NearbySchema.parse({ ...NEARBY, plants: { "osm:way/1": ["osm:way/10", 334, []] } }),
    ).toThrow();
  });

  it("names a plant's nearest substation, its distance and its lines, or nothing", () => {
    expect(aroundOf(NEARBY, "osm:way/1")).toEqual({
      substation: "osm:way/10",
      metres: 334,
      lines: ["osm:way/20", "osm:way/21"],
    });
    expect(aroundOf(NEARBY, "osm:way/2")).toBeNull();
  });
});
