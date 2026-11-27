import { describe, expect, it } from "vitest";

import {
  ARROW_HALF,
  borderFlows,
  borderOverlay,
  flowOverlay,
  GasFlowsSchema,
  latestBorderDay,
  type GasBorder,
  type GasFlows,
} from "./gasFlows";

const PLACE = {
  lon: 15.7516,
  lat: 46.209509,
  source: "openstreetmap",
  sourceId: "way/854206570",
  license: "ODbL-1.0",
  retrievedAt: "2026-11-27",
  what: "where the pipeline crosses the border",
};

const border = (id: string, net: (number | null)[], over: Partial<GasBorder> = {}): GasBorder => ({
  id,
  label: id,
  country: "HR",
  neighbour: "SI",
  operator: "Plinacro Ltd",
  points: ["ITP-00042"],
  place: PLACE,
  // due south of the crossing: Croatia's side of the pipeline
  inside: [15.7516, 46.1],
  netKwhPerDay: net,
  status: net.map((value) => (value === null ? null : "P")),
  ...over,
});

const FLOWS: GasFlows = GasFlowsSchema.parse({
  version: 1,
  generatedAt: "2026-11-27T02:00:00+00:00",
  source: "ENTSOG Transparency Platform",
  sourceUrl: "https://transparency.entsog.eu/",
  unit: "kWh/d",
  days: ["2026-11-24", "2026-11-25", "2026-11-26"],
  countries: {
    HR: {
      operatorKey: "HR-TSO-0001",
      operator: "Plinacro Ltd",
      points: [
        {
          key: "LNG-00032",
          label: "Croatia LNG",
          kind: "LNG",
          direction: "entry",
          neighbour: null,
          kwhPerDay: [1e8, 1e8, 1e8],
          status: ["P", "P", "P"],
          place: { ...PLACE, lon: 14.53, lat: 45.2 },
        },
        {
          key: "ITP-00042",
          label: "Rogatec",
          kind: "ITP",
          direction: "exit",
          neighbour: "SI",
          kwhPerDay: [25e6, 25e6, 25e6],
          status: ["P", "P", "P"],
          place: PLACE,
        },
      ],
    },
  },
  missing: [],
  borders: [
    border("rogatec", [-25e6, -24e6, null]),
    border("murfeld", [16e6, 0, null], { country: "SI", neighbour: "AT", status: ["C", "C", null] }),
  ],
});

describe("gas across the borders", () => {
  it("reads a document written before the borders were", () => {
    const older: Partial<GasFlows> = { ...FLOWS };
    delete older.borders;
    expect(GasFlowsSchema.parse(older).borders).toEqual([]);
  });

  it("turns the net figure into which way the gas went, largest first", () => {
    const flows = borderFlows(FLOWS, "2026-11-24");
    expect(flows.map((flow) => [flow.border.id, flow.from, flow.to, flow.kwh, flow.provisional])).toEqual([
      // out of Croatia: into Slovenia
      ["rogatec", "HR", "SI", 25e6, true],
      ["murfeld", "AT", "SI", 16e6, false],
    ]);
    // nothing went across: still shown, as zero, between the border's own two
    expect(borderFlows(FLOWS, "2026-11-25").find((flow) => flow.border.id === "murfeld")).toMatchObject({
      kwh: 0,
      from: "AT",
      to: "SI",
    });
    // a day without a figure is left out, not drawn as zero; a day not in the data has nothing
    expect(borderFlows(FLOWS, "2026-11-26")).toEqual([]);
    expect(borderFlows(FLOWS, "2026-01-01")).toEqual([]);
    expect(latestBorderDay(FLOWS)).toBe("2026-11-25");
    expect(latestBorderDay({ ...FLOWS, borders: [] })).toBeNull();
  });

  it("draws an arrow at the crossing, along the pipeline, the way the gas went", () => {
    const features = borderOverlay(FLOWS, "2026-11-24", (flow) => `${flow.border.label} ${flow.to}`).features;
    const rogatec = features.filter((feature) => feature.properties.id === "rogatec");
    expect(rogatec.map((feature) => feature.geometry.type)).toEqual(["LineString", "Polygon", "Point"]);
    const [shaft, head, label] = rogatec;
    if (shaft?.geometry.type !== "LineString" || head?.geometry.type !== "Polygon") throw new Error("shape");
    const [start, end] = shaft.geometry.coordinates;
    // Croatia's side is south: gas going out of Croatia goes north, from south of the border to north of it
    expect(start?.[1]).toBeCloseTo(PLACE.lat - ARROW_HALF, 6);
    expect(end?.[1]).toBeGreaterThan(PLACE.lat);
    expect(start?.[0]).toBeCloseTo(PLACE.lon, 6);
    expect(head.geometry.coordinates[0]?.[0]?.[1]).toBeCloseTo(PLACE.lat + ARROW_HALF, 6);
    expect(label?.geometry).toEqual({ type: "Point", coordinates: [PLACE.lon, PLACE.lat] });
    expect(label?.properties).toEqual({ id: "rogatec", kwh: 25e6, text: "rogatec SI" });
    // into Slovenia, that is south here: the arrow turns round
    const murfeld = features.find((f) => f.properties.id === "murfeld" && f.geometry.type === "LineString");
    if (murfeld?.geometry.type !== "LineString") throw new Error("shape");
    expect(murfeld.geometry.coordinates[0]?.[1]).toBeCloseTo(PLACE.lat + ARROW_HALF, 6);
  });

  it("keeps the shaft without a head where nothing went across", () => {
    const murfeld = borderOverlay(FLOWS, "2026-11-25", () => "").features.filter(
      (feature) => feature.properties.id === "murfeld",
    );
    expect(murfeld.map((feature) => feature.geometry.type)).toEqual(["LineString", "Point"]);
  });

  it("leaves the circle off a border point, which has its arrow", () => {
    const keys = flowOverlay(FLOWS, "HR", "2026-11-24", () => "").features.map((f) => f.properties.key);
    expect(keys).toEqual(["LNG-00032"]);
  });
});
