import { describe, expect, it } from "vitest";

import type { Periods, YearFile } from "../data/energy";
import { createI18n } from "../i18n";
import { CARD_FORMATS, CARD_SIZES } from "./dayCard";
import { ringArcs } from "./ring";
import { drawSourcesCard, foldParts, latestDay, latestMonth, sourcesCountries } from "./sourcesCard";
import { sourcesSummary, sourcesText } from "./sourcesText";

/** Three days of Croatia: the last one is still running (62 % reported), the one before lacks its load. */
const DAYS: YearFile = {
  version: 1,
  year: 2026,
  unit: "MWh",
  days: ["2026-11-15", "2026-11-16", "2026-11-17"],
  countries: {
    HR: {
      generation: {
        hydro: [20000, 16000, 9000],
        wind: [10000, 14000, 8000],
        gas: [5000, 4000, 2000],
        coal: [3000, 3000, 1500],
        solar: [1000, 1000, 600],
        biomass: [500, 1500, 900],
        pumped_storage: [500, 400, 300],
        other: [0, 100, 50],
        oil: [null, null, null],
      },
      consumption: { pumped_storage: [10, 20, 5] },
      load: [45000, 50000, 27000],
      coverage: { generation: [1, 1, 0.62], load: [1, 0.96, 0.62] },
    },
  },
};

const block = (
  periods: string[],
  hydro: number[],
  gas: number[],
  load: (number | null)[],
  cover: number[],
) => ({
  periods,
  generation: { hydro, gas },
  consumption: {},
  load,
  coverage: { generation: cover, load: cover },
});

const PERIODS: Periods = {
  version: 1,
  unit: "MWh",
  countries: {
    HR: {
      months: block(
        ["2026-09", "2026-10", "2026-11"],
        [600000, 700000, 300000],
        [200000, 300000, 100000],
        [900000, 950000, 500000],
        [1, 1, 0.57],
      ),
      years: block(["2026"], [1600000], [600000], [null], [0.88]),
    },
  },
};

const hr = createI18n("hr");

describe("the sources of a complete day or month", () => {
  it("takes the latest day reported in full, and its load only when that was reported in full too", () => {
    const day = latestDay([DAYS], "HR");
    expect(day?.period).toBe("2026-11-16");
    expect(day?.totalMwh).toBe(40000);
    expect(day?.parts.map((part) => part.technology)).toEqual([
      "hydro",
      "wind",
      "gas",
      "coal",
      "biomass",
      "solar",
      "pumped_storage",
      "other",
    ]);
    // hydro, wind, solar and biomass of 40 000: pumped storage is not renewable
    expect(day?.renewableShare).toBeCloseTo(32500 / 40000, 6);
    // the load of that day was reported for 96 % of it: no load, and so no sentence about imports
    expect(day?.loadMwh).toBeNull();
    expect(latestDay([DAYS], "SI")).toBeNull();
  });

  it("works out the carbon figure from the same parts, storage left out", () => {
    const day = latestDay([{ ...DAYS, days: DAYS.days.slice(0, 1) }], "HR");
    expect(day?.period).toBe("2026-11-15");
    const grams = 20000 * 24 + 10000 * 11 + 5000 * 490 + 3000 * 820 + 1000 * 48 + 500 * 230;
    expect(day?.co2).toBeCloseTo(grams / 39500, 6);
    expect(day?.loadMwh).toBe(45000);
  });

  it("takes the latest complete month and knows which countries have a picture", () => {
    const month = latestMonth(PERIODS, "HR");
    expect(month?.period).toBe("2026-10");
    expect(month?.totalMwh).toBe(1000000);
    expect(month?.loadMwh).toBe(950000);
    expect(latestMonth(PERIODS, "AT")).toBeNull();
    expect(sourcesCountries(PERIODS, ["SI", "HR", "AT"])).toEqual(["HR"]);
  });

  it("names the five largest sources and folds the rest into one part", () => {
    const day = latestDay([DAYS], "HR");
    if (!day) throw new Error("no day");
    const { named, restShare } = foldParts(day.parts);
    expect(named).toHaveLength(5);
    expect(restShare).toBeCloseTo(1500 / 40000, 6);
    const text = sourcesText(day, hr);
    expect(text.legend.map((row) => `${row.label} ${row.value}`)).toEqual([
      "Hidro 40 %",
      "Vjetar 35 %",
      "Plin 10 %",
      "Ugljen 8 %",
      "Biomasa 4 %",
      "ostali izvori 4 %",
    ]);
    expect(text.centre).toEqual({ value: "81 %", label: "obnovljivo" });
    expect(text.subtitle).toBe("Hrvatska · 16. studenoga 2026. · cijeli dan");
    expect(text.sentence).toBeNull();
  });

  it("says who covered the difference only from the two measured totals", () => {
    const month = latestMonth(PERIODS, "HR");
    if (!month) throw new Error("no month");
    const text = sourcesText(month, hr);
    expect(text.subtitle).toBe("Hrvatska · listopad 2026.");
    expect(text.figures.map((f) => `${f.value} ${f.unit} ${f.label}`)).toEqual([
      "1 TWh proizvedeno",
      "950 GWh potrošeno (opterećenje sustava)",
      "≈ 160 g/kWh CO₂ otisak proizvodnje (izračun)",
    ]);
    expect(text.sentence).toBe(
      "Proizvodnja je bila veća od potrošnje za 50 GWh: višak je izvezen ili pohranjen.",
    );
    const more = sourcesText({ ...month, loadMwh: 1200000 }, hr);
    expect(more.sentence).toBe("Potrošnja je bila veća od proizvodnje za 200 GWh: razliku je pokrio uvoz.");
    expect(sourcesSummary(text)).toContain("70 % obnovljivo; Hidro 70 %, Plin 30 %.");
    expect(sourcesSummary(text)).toMatch(/IPCC AR5 · gridatlas\.eu$/);
  });
});

describe("the ring", () => {
  it("starts at twelve o'clock, goes clockwise and closes exactly", () => {
    const arcs = ringArcs([
      { share: 1, colour: "a" },
      { share: 0, colour: "none" },
      { share: 3, colour: "b" },
    ]);
    expect(arcs.map((arc) => arc.colour)).toEqual(["a", "b"]);
    expect(arcs[0]?.start).toBeCloseTo(-Math.PI / 2, 9);
    expect(arcs[0]?.end).toBeCloseTo(0, 9);
    expect(arcs[1]?.end).toBe(-Math.PI / 2 + 2 * Math.PI);
    expect(ringArcs([{ share: 0, colour: "a" }])).toEqual([]);
  });
});

describe("the drawing", () => {
  it.each(CARD_FORMATS)("writes every text inside the %s picture", (format) => {
    const month = latestMonth(PERIODS, "HR");
    if (!month) throw new Error("no month");
    const text = sourcesText({ ...month, loadMwh: 1200000 }, hr);
    const written: { text: string; x: number; y: number }[] = [];
    let size = 10;
    let align = "left";
    const ctx = {
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      fillRect: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      arc: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      measureText: (each: string) => ({ width: each.length * size * 0.55 }),
      fillText: (each: string, x: number, y: number) => {
        const width = each.length * size * 0.55;
        written.push({
          text: each,
          x: align === "right" ? x - width : align === "center" ? x - width / 2 : x,
          y,
        });
        expect(x - (align === "left" ? 0 : width)).toBeGreaterThanOrEqual(0);
      },
      set font(value: string) {
        size = Number(/(\d+)px/.exec(value)?.[1] ?? 10);
      },
      set textAlign(value: string) {
        align = value;
      },
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textBaseline: "",
    };
    drawSourcesCard(ctx as unknown as CanvasRenderingContext2D, text, "sans-serif", format);
    const { width, height } = CARD_SIZES[format];
    const all = written.map((each) => each.text).join(" ");
    for (const part of ["Hidro", "70 %", "obnovljivo", "1,2", "TWh", "≈ 160", "gridatlas.eu", "uvoz."]) {
      expect(all).toContain(part);
    }
    for (const each of written) {
      expect(each.y).toBeLessThan(height);
      expect(each.x + each.text.length * 4).toBeLessThan(width);
    }
    // nothing is written below the footer, and the footer is the last text down the picture
    const lowest = written.reduce((low, each) => (each.y > low.y ? each : low));
    expect(lowest.text).toContain("gridatlas.eu");
  });
});
