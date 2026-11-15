import { describe, expect, it } from "vitest";

import { SAMPLE_GEOTHERMAL } from "../data/geothermal.fixture";
import type { Mix } from "../data/mix";
import { toCsv } from "./csv";
import { geothermalTable, mixTable, timelineTable } from "./tables";

describe("the map bars' tables", () => {
  it("lists the hour's mix with each import, the unexplained part and the total", () => {
    const mix: Mix = {
      index: 3,
      totalMw: 2000,
      technologies: [
        { technology: "hydro", mw: 1000, share: 0.5 },
        { technology: "solar", mw: 400, share: 0.2 },
      ],
      imports: [{ country: "SI", mw: 400, share: 0.2, known: true }],
      unknownImportMw: 200,
      incomplete: false,
    };
    const table = mixTable(mix, {
      source: "Izvor",
      share: "Udio",
      total: "Ukupno",
      importFrom: (country) => `Uvoz: ${country}`,
      unknown: "Nepoznato",
      technology: (tech) => ({ hydro: "Hidro", solar: "Sunce" })[tech as "hydro" | "solar"],
      country: (code) => (code === "SI" ? "Slovenija" : code),
    });
    expect(toCsv(table)).toBe(
      "Izvor,MW,Udio (%)\r\nHidro,1000,50\r\nSunce,400,20\r\nUvoz: Slovenija,400,20\r\nNepoznato,200,10\r\nUkupno,2000,100\r\n",
    );
  });

  it("puts one year on each row of the time machine's table", () => {
    const table = timelineTable(
      [
        { technology: "hydro", mw: [10, 12] },
        { technology: "wind", mw: [0, 5] },
      ],
      1999,
      { year: "Godina", technology: (tech) => tech },
    );
    expect(table.header).toEqual(["Godina", "hydro (MW)", "wind (MW)"]);
    expect(table.rows).toEqual([
      [1999, 10, 0],
      [2000, 12, 5],
    ]);
  });

  it("lists every geothermal site with empty cells for what is not known", () => {
    const table = geothermalTable(SAMPLE_GEOTHERMAL, {
      site: "Lokacija",
      place: "Mjesto",
      phase: "Faza",
      electric: "Snaga struje",
      thermal: "Toplinska snaga",
      temperature: "Temperatura",
      uses: "Upotrebe",
      sources: "Izvori",
      phaseName: (phase) => phase,
    });
    expect(table.rows).toHaveLength(SAMPLE_GEOTHERMAL.sites.length);
    const velika = table.rows.find((row) => row[0] === "Velika 1");
    expect(velika?.slice(0, 4)).toEqual(["Velika 1", "Velika Ciglena", "operating", 16.5]);
    expect(toCsv(table)).not.toContain("undefined");
  });
});
