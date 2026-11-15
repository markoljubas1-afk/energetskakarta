import { describe, expect, it } from "vitest";

import type { Current } from "../data/current";
import type { Periods } from "../data/energy";
import type { Live } from "../data/live";
import { dayPrices, lastComplete, localDate, priceDays, yearRows } from "./energyPages";
import { buildPages, type SiteData, type StaticPage } from "./pages";
import { llmsTxt } from "./sitemap";
import { SAMPLE_CURRENT } from "./site.fixture";

const current: Current = {
  ...SAMPLE_CURRENT,
  buildId: "20261108T060000Z",
  createdAt: "2026-11-08T06:00:00+00:00",
};

/** Invented figures in MWh: HR 2024 and 2025 complete, 2026 only 85 % reported; SI has 2025 only. */
const block = (
  periods: string[],
  generation: Record<string, (number | null)[]>,
  load: (number | null)[],
  coverage: number[],
) => ({ periods, generation, consumption: {}, load, coverage: { generation: coverage, load: coverage } });
const years = ["2024", "2025", "2026"];
const energy: Periods = {
  version: 1,
  unit: "MWh",
  countries: {
    HR: {
      months: block([], {}, [], []),
      years: block(
        years,
        {
          hydro: [6_000_000, 6_500_000, 4_000_000],
          wind: [2_000_000, 2_200_000, 1_500_000],
          solar: [500_000, 900_000, 800_000],
          gas: [2_000_000, 1_400_000, 900_000],
          pumped_storage: [100_000, 100_000, 50_000],
        },
        [18_000_000, 18_500_000, 15_000_000],
        [1, 1, 0.85],
      ),
    },
    SI: {
      months: block([], {}, [], []),
      years: block(
        years,
        { nuclear: [null, 5_400_000, null], hydro: [null, 4_000_000, null] },
        [null, 13_000_000, null],
        [0, 1, 0],
      ),
    },
  },
};

const hoursOf = (date: string): string[] =>
  Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, "0")}:00:00+01:00`);
const today = hoursOf("2026-11-08");
const tomorrow = hoursOf("2026-11-09");
const live: Live = {
  version: 1,
  generatedAt: "2026-11-08T12:30:00+00:00",
  timezone: "Europe/Zagreb",
  hours: [...today, ...tomorrow],
  flows: [],
  prices: {
    // HR: 80 €/MWh all day, except 40 at 13:00 and 160 at 18:00, and no price at 03:00; tomorrow 100
    HR: {
      zone: "10YHR-HEP------M",
      eurPerMwh: [
        ...today.map((_, h) => (h === 3 ? null : h === 13 ? 40 : h === 18 ? 160 : 80)),
        ...tomorrow.map(() => 100),
      ],
    },
    SI: { zone: "10YSI-ELES-----O", eurPerMwh: [...today.map(() => 90), ...tomorrow.map(() => null)] },
    IT_NORD: { zone: "10Y1001A1001A73I", eurPerMwh: [...today.map(() => 110), ...tomorrow.map(() => 120)] },
  },
  missing: { flows: [], prices: ["BA", "ME"] },
};

const site: SiteData = {
  siteUrl: "https://karta.example",
  dataBaseUrl: "https://podaci.example/",
  current,
  stats: { version: 1, voltageClasses: [], note: "", plants: {}, substations: {}, lineKm: {} },
  index: { version: 1, fields: ["id", "name", "layer", "country", "lon", "lat", "detail"], rows: [] },
  cities: null,
  diff: null,
  energy,
  live,
};
const pages = buildPages(site);
const page = (path: string): StaticPage => {
  const found = pages.find((p) => p.path === path);
  if (!found) throw new Error(`no page ${path}`);
  return found;
};

describe("generation by year", () => {
  it("sums the sources, counts renewables without pumped storage and marks incomplete years", () => {
    const rows = yearRows(energy, "HR") ?? [];
    // 2025: 6.5 + 2.2 + 0.9 + 1.4 + 0.1 = 11.1 TWh; renewables 6.5 + 2.2 + 0.9 = 9.6 TWh
    expect(rows[1]).toMatchObject({ year: "2025", total: 11_100_000, renewable: 9_600_000, complete: true });
    expect(rows[1]?.share).toBeCloseTo(9.6 / 11.1, 6);
    expect(rows[2]?.complete).toBe(false);
    expect(lastComplete(rows)?.year).toBe("2025");
    expect(yearRows(energy, "IT")).toBeNull();
  });

  it("writes a citable line about the latest complete year", () => {
    const hr = page("/proizvodnja/hr/");
    expect(hr.title).toBe("Proizvodnja struje u Hrvatskoj po izvorima (2024.–2025.)");
    // 9.6 / 11.1 = 86.5 %; hydro 6.5 / 11.1 = 58.6 %, wind 19.8 %, solar 8.1 %
    expect(hr.lead).toContain(
      "Hrvatska je u 2025. proizvela 11,1 TWh struje; obnovljivi izvori dali su 86,5",
    );
    expect(hr.lead).toContain("hidro 58,6");
    expect(hr.lead).toContain("Potrošnja (ukupno opterećenje sustava) bila je 18,5 TWh.");
    const years = hr.sections.find((section) => section.heading === "Po godinama")?.html ?? "";
    expect(years).toContain("<td>2026*</td>");
    expect(years.indexOf("2026*")).toBeLessThan(years.indexOf(">2024<"));
    expect(page("/en/electricity-generation/hr/").title).toBe(
      "Electricity generation in Croatia by source (2024–2025)",
    );
  });

  it("lists every country with data on the overview, and links it from the country page", () => {
    const overview = page("/proizvodnja/").sections[0]?.html ?? "";
    expect(overview).toContain('<a href="/proizvodnja/hr/">Hrvatska</a>');
    expect(overview).toContain('<a href="/proizvodnja/si/">Slovenija</a>');
    expect(overview).toContain("Nuklearna"); // Slovenia's largest source in 2025
    const country = page("/zemlja/hr/").sections.find(
      (s) => s.heading === "Proizvodnja struje i cijene",
    )?.html;
    expect(country).toContain('<a href="/proizvodnja/hr/">Proizvodnja struje u Hrvatskoj</a>');
    expect(country).toContain('<a href="/cijene-struje/">Cijena struje danas</a>');
    expect(pages.some((p) => p.path === "/proizvodnja/it/")).toBe(false);
  });
});

describe("day-ahead prices", () => {
  it("takes today as the local day the document was made, and tomorrow once it has prices", () => {
    expect(localDate("2026-11-08T23:30:00+00:00", "Europe/Zagreb")).toBe("2026-11-09");
    const days = priceDays(live);
    expect(days?.today.date).toBe("2026-11-08");
    expect(days?.tomorrow?.date).toBe("2026-11-09");
    // Slovenia has no prices for tomorrow yet: it is left out of tomorrow, not shown as zero
    expect(days?.tomorrow?.zones.map((zone) => zone.country)).toEqual(["HR", "IT"]);
  });

  it("averages the hours that have a price and finds the lowest and highest hour", () => {
    const hr = dayPrices(live, "2026-11-08").zones.find((zone) => zone.country === "HR");
    // 21 hours at 80 + 40 + 160 = 1880 over 23 hours with a price = 81.739…
    expect(hr?.average).toBeCloseTo(1880 / 23, 6);
    expect(hr?.low).toEqual({ value: 40, hour: "13:00" });
    expect(hr?.high).toEqual({ value: 160, hour: "18:00" });
    expect(hr?.values[3]).toBeNull();
  });

  it("puts the day's figures for Croatia in the first sentence", () => {
    const prices = page("/cijene-struje/");
    expect(prices.heading).toBe("Cijena struje na burzi, 8. studenoga 2026.");
    expect(prices.lead).toContain(
      "Cijena struje na burzi dan-unaprijed za 8. studenoga 2026., Hrvatska: prosječno 81,74 €/MWh, najniža 40 €/MWh (13:00), najviša 160 €/MWh (18:00).",
    );
    expect(prices.lead).toContain("Za 9. studenoga 2026. prosjek je 100 €/MWh.");
    expect(prices.sections.map((s) => s.heading)).toContain("Po satu, 9. studenoga 2026. (€/MWh)");
    expect(page("/en/electricity-prices/").alternatePath).toBe("/cijene-struje/");
    expect(buildPages({ ...site, live: null }).some((p) => p.path === "/cijene-struje/")).toBe(false);
  });

  it("are announced in llms.txt", () => {
    const text = llmsTxt(site);
    expect(text).toContain("(https://karta.example/en/electricity-generation/)");
    expect(text).toContain("(https://karta.example/en/electricity-prices/)");
  });
});
