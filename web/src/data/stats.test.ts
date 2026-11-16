import { describe, expect, it } from "vitest";

import { StatsSchema, statusTotals, summarize } from "./stats";

const stats = StatsSchema.parse({
  version: 1,
  voltageClasses: ["380+", "220-379", "110-219", "60-109", "unknown"],
  note: "OSM",
  plants: {
    HR: {
      wind: { operating: { count: 2, capacityMw: 150, withCapacity: 1 } },
      solar: { planned: { count: 3, capacityMw: 30, withCapacity: 3 } },
      hydro: { operating: { count: 1, capacityMw: 276, withCapacity: 1 } },
    },
    SI: {
      nuclear: { operating: { count: 1, capacityMw: 696, withCapacity: 1 } },
      mystery: { operating: { count: 1, capacityMw: 5, withCapacity: 1 } },
    },
  },
  substations: { HR: { "380+": 2, unknown: 1 }, SI: { "110-219": 4 } },
  lineKm: {
    HR: { "380+": { operating: 100.5, construction: 20 }, "110-219": { planned: 7 } },
    SI: { "380+": { operating: 40 }, bogus: { operating: 1 } },
  },
});

describe("summarize", () => {
  it("summarises one country, largest operating capacity first", () => {
    const hr = summarize(stats, "HR", ["HR", "SI"]);
    expect(hr.technologies.map((t) => t.technology)).toEqual(["hydro", "wind", "solar"]);
    expect(hr.operatingMw).toBe(426);
    expect(hr.pipelineMw).toBe(30);
    expect(hr.technologies.find((t) => t.technology === "wind")?.plantsWithoutCapacity).toBe(1);
    // three planned solar plants count among the plants, not among the operating ones (Faza 31)
    const solar = hr.technologies.find((t) => t.technology === "solar");
    expect([solar?.plants, solar?.operatingPlants]).toEqual([3, 0]);
    expect(hr.technologies.reduce((sum, t) => sum + t.operatingPlants, 0)).toBe(3);
    expect(hr.substations).toBe(3);
    // only operating kilometres, and only classes that have any
    expect(hr.lineKm).toEqual([{ voltage: "380+", km: 100.5 }]);
  });

  it("adds countries together for the region and maps unknown technologies to other", () => {
    const all = summarize(stats, "ALL", ["HR", "SI"]);
    expect(all.operatingMw).toBe(426 + 701);
    expect(all.technologies.find((t) => t.technology === "other")?.operatingMw).toBe(5);
    expect(all.lineKm).toEqual([{ voltage: "380+", km: 140.5 }]);
    expect(all.substations).toBe(7);
  });

  it("returns an empty summary for a country without data", () => {
    expect(summarize(stats, "ME", ["HR", "SI", "ME"])).toEqual({
      technologies: [],
      operatingMw: 0,
      pipelineMw: 0,
      lineKm: [],
      substations: 0,
      datacenters: { count: 0, powerMw: 0, withPower: 0 },
    });
  });

  it("counts data centres, and how many of them published a power", () => {
    const withCentres = {
      ...stats,
      datacenters: {
        HR: {
          operating: { count: 2, powerMw: 2.5, withPower: 1 },
          planned: { count: 1, powerMw: 0, withPower: 0 },
        },
      },
    };
    expect(summarize(withCentres, "HR", ["HR"]).datacenters).toEqual({
      count: 3,
      powerMw: 2.5,
      withPower: 1,
    });
    // a build from before the layer existed simply has no such section
    expect(summarize(stats, "HR", ["HR"]).datacenters).toEqual({ count: 0, powerMw: 0, withPower: 0 });
  });
});

describe("statusTotals", () => {
  const byStatus = StatsSchema.parse({
    version: 1,
    voltageClasses: ["380+"],
    note: "",
    plants: {
      HR: {
        hydro: { operating: { count: 3, capacityMw: 100, withCapacity: 3 } },
        solar: {
          planned: { count: 2, capacityMw: 9, withCapacity: 1 },
          construction: { count: 1, capacityMw: 5, withCapacity: 1 },
        },
      },
      SI: { wind: { planned: { count: 4, capacityMw: 40, withCapacity: 4 } } },
    },
    substations: {},
    lineKm: {
      HR: { "380+": { operating: 1000, construction: 12.5 }, "110-219": { planned: 3 } },
      SI: { "380+": { planned: 7 } },
    },
  });

  it("counts plants and line kilometres by status, for the chosen countries or for all of them", () => {
    expect(statusTotals(byStatus, new Set())).toEqual({
      operating: { plants: 3, lineKm: 1000 },
      construction: { plants: 1, lineKm: 12.5 },
      planned: { plants: 6, lineKm: 10 },
    });
    expect(statusTotals(byStatus, new Set(["SI"] as const)).planned).toEqual({ plants: 4, lineKm: 7 });
  });
});
