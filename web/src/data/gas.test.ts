import { afterEach, describe, expect, it, vi } from "vitest";

import { fromProperties } from "../map/selection";
import { jsonResponse } from "../test/render";
import { byCountry, gasId, gasOverlay, latest, loadGas, type Gas } from "./gas";
import { COUNTRY_ANCHORS } from "./live";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Two Croatian points (one silent on the last day) and one Italian; Slovenia has none. */
const SAMPLE: Gas = {
  version: 1,
  generatedAt: "2026-09-19T07:40:00+00:00",
  source: "ENTSOG Transparency Platform",
  unit: "kWh/d",
  days: ["2026-09-16", "2026-09-17", "2026-09-18"],
  points: [
    {
      key: "A",
      pointDirection: "5HR-TSO-0001PRD-Aentry",
      label: "Panonija",
      country: "HR",
      operator: "Plinacro",
      kwhPerDay: [1_000_000, 1_100_000, null],
    },
    {
      key: "B",
      pointDirection: "5HR-TSO-0001PRD-Bentry",
      label: "Jadran",
      country: "HR",
      operator: "Plinacro",
      kwhPerDay: [null, 2_000_000, 2_500_000],
    },
    {
      key: "C",
      pointDirection: "5IT-TSO-0001PRD-Centry",
      label: "Produzione",
      country: "IT",
      operator: "Snam",
      kwhPerDay: [null, null, null],
    },
    {
      key: "D",
      pointDirection: "5XX-TSO-0001PRD-Dentry",
      label: "Elsewhere",
      country: "XX",
      operator: "Nobody",
      kwhPerDay: [5, 5, 5],
    },
  ],
  missing: { points: [], countries: ["SI"] },
};

describe("byCountry", () => {
  it("sums a country's points per day and keeps a day nobody reported as a gap", () => {
    const [hr, it] = byCountry(SAMPLE);
    expect(hr?.country).toBe("HR");
    expect(hr?.kwhPerDay).toEqual([1_000_000, 3_100_000, 2_500_000]);
    expect(hr?.points.map((p) => p.label)).toEqual(["Panonija", "Jadran"]);
    expect(it?.kwhPerDay).toEqual([null, null, null]);
    // a country outside the scope is not a country on this map
    expect(byCountry(SAMPLE).map((c) => c.country)).toEqual(["HR", "IT"]);
  });

  it("finds the latest reported day", () => {
    expect(latest([1, null, 3, null])).toEqual({ index: 2, kwh: 3 });
    expect(latest([null, null])).toBeNull();
  });
});

describe("gasOverlay", () => {
  it("places one disc per country with data, below the country's anchor, and round-trips through the selection code", () => {
    const overlay = gasOverlay(SAMPLE);
    expect(overlay.features.map((f) => f.id)).toEqual([gasId("HR")]); // IT never reported: no disc
    const [feature] = overlay.features;
    const [lon, lat] = feature?.geometry.coordinates ?? [0, 0];
    expect(lon).toBe(COUNTRY_ANCHORS.HR[0]);
    expect(lat).toBeLessThan(COUNTRY_ANCHORS.HR[1]);
    expect(feature?.properties.latestKwh).toBe(2_500_000);
    expect(feature?.properties.latestDay).toBe("2026-09-18");

    const props: Record<string, unknown> = { ...feature?.properties };
    const selection = fromProperties("gas", props);
    expect(selection).toMatchObject({
      kind: "gas",
      id: "gas:HR",
      country: "HR",
      days: SAMPLE.days,
      kwhPerDay: [1_000_000, 3_100_000, 2_500_000],
      points: [
        { label: "Panonija", operator: "Plinacro" },
        { label: "Jadran", operator: "Plinacro" },
      ],
      sources: ["entsog"],
    });
    // damaged properties are refused rather than shown half-read
    expect(fromProperties("gas", { ...props, kwhPerDay: "[1]" })).toBeNull();
    expect(fromProperties("gas", { ...props, country: "XX" })).toBeNull();
  });
});

describe("loadGas", () => {
  const base = new URL("https://data.test/");

  it("treats a missing document as not published", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 404 }))),
    );
    await expect(loadGas(base, new AbortController().signal)).resolves.toEqual({ kind: "none" });
  });

  it("parses a document and refuses one whose columns do not match its days", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(SAMPLE))),
    );
    await expect(loadGas(base, new AbortController().signal)).resolves.toEqual({
      kind: "ready",
      gas: SAMPLE,
    });
    const broken = { ...SAMPLE, points: [{ ...SAMPLE.points[0], kwhPerDay: [1] }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(broken))),
    );
    await expect(loadGas(base, new AbortController().signal)).rejects.toThrow(/columns/);
  });
});
