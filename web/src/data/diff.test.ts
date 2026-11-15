import { describe, expect, it } from "vitest";

import { buildInstant, DiffSchema, summarizeDiff, type Diff } from "./diff";

const report = (
  counts: { added?: number; changed?: number; removed?: number; unchanged?: number },
  byCountry: Diff["layers"][string]["byCountry"] = {},
  examples: Partial<Diff["layers"][string]["examples"]> = {},
): Diff["layers"][string] => ({
  added: counts.added ?? 0,
  changed: counts.changed ?? 0,
  removed: counts.removed ?? 0,
  unchanged: counts.unchanged ?? 0,
  byCountry,
  examples: { added: [], changed: [], removed: [], ...examples },
});

const diff: Diff = {
  version: 1,
  buildId: "20260919T074428Z",
  baselineBuildId: "20260912T030000Z",
  layers: {
    plants: report(
      { added: 1, changed: 1, unchanged: 5 },
      { HR: { added: 1, changed: 1 } },
      {
        added: [{ id: "osm:way/1", name: "Nova", lon: 15, lat: 45 }],
        changed: [{ id: "osm:way/2", name: null }],
      },
    ),
    lines: report(
      { removed: 1, unchanged: 3 },
      { HR: { removed: 1 }, "?": { removed: 0 } },
      { removed: [{ id: "osm:way/999", name: "Stari", lon: 15.6, lat: 45.4 }] },
    ),
    substations: report({ unchanged: 2 }, { HR: {} }),
    // a layer the site does not know is ignored, not an error
    unknown_layer: report({ added: 9 }, { HR: { added: 9 } }),
  },
};

describe("DiffSchema", () => {
  it("accepts the pipeline's shape and examples without a point", () => {
    expect(DiffSchema.parse(diff).layers.plants?.examples.changed[0]?.lon).toBeUndefined();
  });
});

describe("summarizeDiff", () => {
  it("totals the known layers, lists the busy ones first and skips the quiet ones", () => {
    const summary = summarizeDiff(diff);
    expect(summary.totals).toEqual({ added: 1, changed: 1, removed: 1 });
    expect(summary.layers.map((row) => row.layer)).toEqual(["plants", "lines"]);
    expect(summary.layers[0]?.examples).toEqual([
      { kind: "added", example: { id: "osm:way/1", name: "Nova", lon: 15, lat: 45 } },
      { kind: "changed", example: { id: "osm:way/2", name: null } },
    ]);
    expect(summary.since).toBe("2026-09-12T03:00:00Z");
  });

  it("sums countries across layers and drops the unknown-country bucket", () => {
    expect(summarizeDiff(diff).countries).toEqual([{ country: "HR", added: 1, changed: 1, removed: 1 }]);
  });

  it("marks a first publication as having nothing to compare with", () => {
    expect(summarizeDiff({ ...diff, baselineBuildId: null }).since).toBeNull();
  });

  it("caps the examples shown per kind", () => {
    const many = {
      ...diff,
      layers: {
        plants: report(
          { added: 10 },
          {},
          { added: Array.from({ length: 10 }, (_, i) => ({ id: `osm:node/${i}`, name: null })) },
        ),
      },
    };
    expect(summarizeDiff(many, 3).layers[0]?.examples).toHaveLength(3);
  });
});

describe("buildInstant", () => {
  it("turns a build id into an ISO instant and leaves anything else alone", () => {
    expect(buildInstant("20260901T123000Z")).toBe("2026-09-01T12:30:00Z");
    expect(buildInstant("latest")).toBe("latest");
  });
});
