import { describe, expect, it } from "vitest";

import type { EnergySeries, RangeTotals } from "../data/energy";
import { toCsv } from "../share/csv";
import { compareTable, mixTable, rangeTable, type CsvLabels } from "./csv";

const labels: CsvLabels = {
  period: "Razdoblje",
  load: "Potrošnja",
  complete: "Potpunost",
  year: "Godina",
  source: "Izvor",
  shareOfGeneration: "Udio u proizvodnji",
  shareOfLoad: "Udio u potrošnji",
  total: "Ukupno",
  pumping: "Pumpanje",
  months: ["sij", "velj", "ožu", "tra", "svi", "lip", "srp", "kol", "ruj", "lis", "stu", "pro"],
  technology: (tech) => ({ hydro: "Hidro", solar: "Sunce" })[tech as "hydro" | "solar"] ?? tech,
};

const data: EnergySeries = {
  periods: ["2026-01", "2026-02"],
  generation: { hydro: [500.25, 410], solar: [12, null] },
  pumping: [0, 0],
  load: [1500, null],
  coverage: [1, 0.4567],
  loadCoverage: [1, 0],
  countries: ["HR"],
};

describe("the energy page's CSV", () => {
  it("has the chart's rows and columns: sources and load in MWh, how complete each period is", () => {
    expect(toCsv(mixTable(data, ["hydro", "solar"], labels))).toBe(
      "Razdoblje,Hidro (MWh),Sunce (MWh),Potrošnja (MWh),Potpunost (%)\r\n2026-01,500.25,12,1500,100\r\n2026-02,410,,,45.67\r\n",
    );
  });

  it("puts each year on a row for the month-by-month comparison", () => {
    const table = compareTable(
      [{ year: "2025", values: [1, null, ...Array<number | null>(10).fill(2)], coverage: [] }],
      labels,
    );
    expect(table.header[1]).toBe("sij (MWh)");
    expect(table.rows[0]?.slice(0, 3)).toEqual(["2025", 1, null]);
  });

  it("lists a period's totals with shares, and leaves the load's share empty when the load is unknown", () => {
    const totals: RangeTotals = {
      days: 10,
      coveredDays: 10,
      loadCoveredDays: 0,
      generation: [
        { tech: "hydro", mwh: 750 },
        { tech: "solar", mwh: 250 },
      ],
      total: 1000,
      pumping: 0,
      load: null,
    };
    expect(rangeTable(totals, labels).rows).toEqual([
      ["Hidro", 750, 75, null],
      ["Sunce", 250, 25, null],
      ["Ukupno", 1000, 100, null],
      ["Potrošnja", null, null, null],
    ]);
  });
});
