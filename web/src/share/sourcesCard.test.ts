import { describe, expect, it } from "vitest";

import type { Periods, YearFile } from "../data/energy";
import { createI18n } from "../i18n";
import { CARD_FORMATS, CARD_SIZES } from "./dayCard";
import { ringArcs } from "./ring";
import { COMPLETE_COVERAGE } from "../seo/energyPages";
import {
  askedPictureMonth,
  drawSourcesCard,
  foldParts,
  latestDay,
  latestMonth,
  MONTH_COMPLETE,
  sourcesCountries,
} from "./sourcesCard";
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
    // a monthly report asks for its own month, and gets that one or nothing
    expect(latestMonth(PERIODS, "HR", "2026-09")?.totalMwh).toBe(800000);
    expect(latestMonth(PERIODS, "HR", "2026-11")).toBeNull();
    expect(MONTH_COMPLETE).toBe(COMPLETE_COVERAGE);
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
      "Hidroelektrane 40 %",
      "Vjetroelektrane 35 %",
      "Plinske elektrane 10 %",
      "Elektrane na ugljen 8 %",
      "Elektrane na biomasu 4 %",
      "Ostali izvori 4 %",
    ]);
    expect(text.centre).toEqual({ value: "81 %", label: "obnovljivi izvori" });
    expect(text.subtitle).toBe("Hrvatska · 16. studenoga 2026. · cijeli dan");
    expect(text.sentence).toBeNull();
  });

  it("says who covered the difference only from the two measured totals", () => {
    const month = latestMonth(PERIODS, "HR");
    if (!month) throw new Error("no month");
    const text = sourcesText(month, hr);
    expect(text.subtitle).toBe("Hrvatska · listopad 2026.");
    expect(text.figures.map((f) => `${f.value} ${f.unit} ${f.label}`)).toEqual([
      "1 TWh Proizvodnja",
      "950 GWh Potrošnja",
      "≈ 160 g/kWh Ugljični otisak (izračun)",
    ]);
    expect(text.sentence).toBe(
      "Proizvodnja je premašila potrošnju za 50 GWh; višak je izvezen ili pohranjen.",
    );
    const more = sourcesText({ ...month, loadMwh: 1200000 }, hr);
    expect(more.sentence).toBe("Potrošnja je premašila proizvodnju za 200 GWh; razlika je namirena uvozom.");
    expect(sourcesSummary(text)).toContain(
      "70 % obnovljivi izvori; Hidroelektrane 70 %, Plinske elektrane 30 %.",
    );
    expect(sourcesSummary(text)).toMatch(/IPCC AR5 · gridatlas\.eu$/);
  });
});

describe("the link from a monthly report", () => {
  it("reads the month from the address, and nothing that is not a month", () => {
    expect(askedPictureMonth("?pic=2026-10")).toBe("2026-10");
    expect(askedPictureMonth("?l=plants&pic=2025-01&c=HR")).toBe("2025-01");
    expect(askedPictureMonth("?pic=2026-13")).toBeNull();
    expect(askedPictureMonth("?pic=listopad")).toBeNull();
    expect(askedPictureMonth("")).toBeNull();
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
    // the fullest picture: six rows of sources, three figures and the sentence
    const day = latestDay([DAYS], "HR");
    if (!day) throw new Error("no day");
    const text = sourcesText({ ...day, loadMwh: 52000 }, hr);
    expect(text.legend).toHaveLength(6);
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
    for (const part of [
      "Hidroelektrane",
      "40 %",
      "Ostali izvori",
      "obnovljivi izvori",
      "52",
      "GWh",
      "≈ ",
      "gridatlas.eu",
      "uvozom.",
    ]) {
      expect(all).toContain(part);
    }
    for (const each of written) {
      expect(each.y).toBeLessThan(height);
      expect(each.x + each.text.length * 4).toBeLessThan(width);
    }
    // the sentence ends a clear line above the footer
    const sentenceEnd = Math.max(
      ...written.filter((each) => each.text.endsWith("uvozom.")).map((each) => each.y),
    );
    const footerStart = Math.min(
      ...written.filter((each) => each.text.startsWith("Izvor:")).map((each) => each.y),
    );
    expect(footerStart - sentenceEnd).toBeGreaterThanOrEqual(format === "story" ? 60 : 30);
    // and starts a clear line below everything above it (a figure's label that wraps must not reach it)
    const sentenceStart = Math.min(
      ...written.filter((each) => each.text.startsWith("Potrošnja je")).map((each) => each.y),
    );
    const above = written.filter((each) => each.y < sentenceStart).map((each) => each.y);
    expect(sentenceStart - Math.max(...above)).toBeGreaterThanOrEqual(30);
    // nothing is written below the footer, and the footer is the last text down the picture
    const lowest = written.reduce((low, each) => (each.y > low.y ? each : low));
    expect(lowest.text).toContain("gridatlas.eu");
  });
});
