import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../test/render";
import { arc, COUNTRY_ANCHORS, dayOf, flowsAt, hourKey, loadLive, overlay, pickHour, pricesAt } from "./live";
import { SAMPLE_LIVE } from "./live.fixture";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hours", () => {
  it("prefers the linked hour, then the current one, then the last", () => {
    expect(pickHour(SAMPLE_LIVE, "2026-09-16T00", new Date())).toBe(1);
    expect(pickHour(SAMPLE_LIVE, null, new Date("2026-09-15T21:30:00Z"))).toBe(0);
    expect(pickHour(SAMPLE_LIVE, "2030-01-01T00", new Date("2020-01-01T00:00:00Z"))).toBe(2);
    expect(hourKey(SAMPLE_LIVE.hours[1] ?? "")).toBe("2026-09-16T00+02");
  });

  it("names days relative to the middle day", () => {
    expect([0, 1, 2].map((i) => dayOf(SAMPLE_LIVE, i))).toEqual([-1, 0, 1]);
  });
});

describe("flows and prices at an hour", () => {
  it("orients flows in the direction power goes and keeps gaps", () => {
    expect(flowsAt(SAMPLE_LIVE, 0)).toEqual([
      { from: "HR", to: "SI", mw: 200 },
      { from: "HU", to: "HR", mw: 400 },
    ]);
    expect(flowsAt(SAMPLE_LIVE, 1)[0]).toEqual({ from: "SI", to: "HR", mw: null });
  });

  it("uses Italy's northern zone for the country", () => {
    expect(pricesAt(SAMPLE_LIVE, 0)).toEqual([
      { country: "HR", zone: "HR", eur: 95.5 },
      { country: "IT", zone: "IT_NORD", eur: 120 },
    ]);
  });
});

describe("overlay", () => {
  it("draws no arrow and no number for a missing hour", () => {
    const { features, labels } = overlay(SAMPLE_LIVE, 1);
    expect(features.features.some((f) => f.properties?.from === "SI" || f.properties?.to === "SI")).toBe(
      false,
    );
    expect(labels.find((l) => l.key.startsWith("flow-SI"))).toBeUndefined();
    expect(labels.find((l) => l.kind === "price" && l.country === "HR")?.eur).toBe(101.25);
  });

  it("starts each arrow at the sending country and closes its head", () => {
    const { features, labels } = overlay(SAMPLE_LIVE, 0);
    const line = features.features.find(
      (f) => f.geometry.type === "LineString" && f.properties?.from === "HR",
    );
    if (line?.geometry.type !== "LineString") throw new Error("HR→SI arc missing");
    expect(line.geometry.coordinates[0]).toEqual(COUNTRY_ANCHORS.HR);
    expect(line.geometry.coordinates.at(-1)).toEqual(COUNTRY_ANCHORS.SI);
    const head = features.features.find((f) => f.geometry.type === "Polygon" && f.properties?.from === "HR");
    if (head?.geometry.type !== "Polygon") throw new Error("HR→SI head missing");
    const ring = head.geometry.coordinates[0] ?? [];
    expect(ring[0]).toEqual(ring.at(-1));
    expect(labels.find((l) => l.key === "flow-SI-HR")?.mw).toBe(200);
    // unknown country codes are ignored
    expect(labels.some((l) => l.key.includes("XX"))).toBe(false);
  });

  it("hands the map a price only for countries that have one at that hour", () => {
    expect(overlay(SAMPLE_LIVE, 0).prices).toEqual({ HR: 95.5, IT: 120 });
    // HR has no price in the last hour: it drops out instead of being painted as zero
    expect(overlay(SAMPLE_LIVE, 2).prices).toEqual({ IT: 117 });
  });

  it("gives a zero flow a line but no head", () => {
    const { features } = overlay(SAMPLE_LIVE, 2);
    const hu = features.features.filter((f) => f.properties?.from === "HU");
    expect(hu.map((f) => f.geometry.type)).toEqual(["LineString"]);
  });

  it("keeps the same bowed arc when the direction flips", () => {
    const forward = arc(COUNTRY_ANCHORS.SI, COUNTRY_ANCHORS.HR, false);
    const backward = arc(COUNTRY_ANCHORS.SI, COUNTRY_ANCHORS.HR, true);
    expect(backward).toEqual([...forward].reverse());
  });
});

describe("loadLive", () => {
  const base = new URL("https://data.test/");

  it("treats a missing document as not published", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 404 }))),
    );
    await expect(loadLive(base, new AbortController().signal)).resolves.toEqual({ kind: "none" });
  });

  it("rejects columns that do not match the hours", async () => {
    const broken = { ...SAMPLE_LIVE, flows: [{ from: "SI", to: "HR", mw: [1] }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(broken))),
    );
    await expect(loadLive(base, new AbortController().signal)).rejects.toThrow(/do not match/);
  });

  it("loads a valid document", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(SAMPLE_LIVE))),
    );
    const result = await loadLive(base, new AbortController().signal);
    expect(result.kind).toBe("ready");
  });
});

describe("hour keys around the autumn clock change", () => {
  const hours = ["2026-10-25T01:00:00+02:00", "2026-10-25T02:00:00+02:00", "2026-10-25T02:00:00+01:00"];
  const live = { ...SAMPLE_LIVE, hours, flows: [], prices: {} };

  it("tells the two 02:00 hours apart", () => {
    expect(hours.map(hourKey)).toEqual(["2026-10-25T01+02", "2026-10-25T02+02", "2026-10-25T02+01"]);
    expect(pickHour(live, "2026-10-25T02+01", new Date(0))).toBe(2);
    expect(pickHour(live, "2026-10-25T02+02", new Date(0))).toBe(1);
  });

  it("still opens links without an offset", () => {
    expect(pickHour(live, "2026-10-25T01", new Date(0))).toBe(0);
  });
});
