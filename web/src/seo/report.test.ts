import { describe, expect, it } from "vitest";

import type { Periods } from "../data/energy";
import { SAMPLE_RENEWABLES } from "../data/eurostat.fixture";
import type { HepHistory } from "../data/hep";
import { createI18n } from "../i18n";
import { atomFeed, hasFeed } from "./feed";
import { homeBody } from "./home";
import { pageMarkdown } from "./markdown";
import { buildPages, type SiteData, type StaticPage } from "./pages";
import { pageHash } from "./prerender";
import {
  REPORTS_FROM,
  reportFeedEntries,
  reportLinks,
  reportMonths,
  reportPages,
  shiftMonth,
} from "./report";
import { inMonth, monthName } from "./reportCopy";
import { bareSite } from "./site.fixture";
import { llmsTxt } from "./sitemap";
import { transitionPages } from "./transition";

/** Every month from September 2024 to October 2026 (26). */
const MONTHS = Array.from({ length: 26 }, (_, i) => shiftMonth("2024-09", i));

/**
 * Invented MWh. Croatia: half hydro, half gas, except three months the tests compare (90 %, 75 % and 55 %
 * renewable); October 2026 is only half reported. Slovenia reports September 2026 only; Montenegro never in full.
 */
const special: Record<string, Record<string, number>> = {
  "2026-09": { hydro: 600, wind: 200, solar: 100, gas: 100 },
  "2026-08": { hydro: 500, wind: 100, solar: 150, gas: 250 },
  "2025-09": { hydro: 400, wind: 100, solar: 50, gas: 450 },
};
const techs = ["hydro", "wind", "solar", "gas", "nuclear"] as const;
const hrMonth = (month: string): Record<string, number> => special[month] ?? { hydro: 500, gas: 500 };

const block = (
  periods: string[],
  generation: Record<string, (number | null)[]>,
  coverage: number[],
  load: (number | null)[] = periods.map(() => null),
) => ({
  periods,
  generation,
  consumption: {},
  load,
  coverage: { generation: coverage, load: coverage },
});

const years = block(["2025"], { hydro: [6_000] }, [1]);

const energy: Periods = {
  version: 1,
  unit: "MWh",
  countries: {
    HR: {
      months: block(
        MONTHS,
        Object.fromEntries(techs.map((t) => [t, MONTHS.map((m) => hrMonth(m)[t] ?? null)])),
        MONTHS.map((m) => (m === "2026-10" ? 0.5 : 1)),
        MONTHS.map(() => 1_200),
      ),
      years,
    },
    SI: {
      months: block(
        MONTHS,
        { hydro: MONTHS.map(() => 300), nuclear: MONTHS.map(() => 500), solar: MONTHS.map(() => 200) },
        MONTHS.map((m) => (m === "2026-09" ? 1 : 0.5)),
      ),
      years,
    },
    ME: {
      months: block(
        MONTHS,
        { hydro: MONTHS.map(() => 100) },
        MONTHS.map(() => 0.5),
      ),
      years,
    },
  },
};

/** One HEP release published in September 2026: two of three substations with free capacity. */
const capacityHistory: HepHistory = {
  version: 1,
  source: "HEP ODS",
  license: "HEP-ODS-permission",
  snapshots: [{ dataVersion: 4, dataDate: "2026-09-01", publishedAt: "2026-09-20T10:00:00+02:00", key: "k" }],
  stations: {
    "TS A": { existing: ["A"], upgraded: ["A"], freeKw: [100] },
    "TS B": { existing: ["none"], upgraded: ["A"], freeKw: [null] },
    "TS C": { existing: ["C"], upgraded: ["B"], freeKw: [5] },
  },
};

const site: SiteData = bareSite({ energy, capacityHistory });
const plain = (value: string): string => value.replace(/[\u00a0\u202f]/g, " ");
const report = (path: string, data: SiteData = site): StaticPage => {
  const found = reportPages(data).find((p) => p.path === path);
  if (!found) throw new Error(`no page ${path}`);
  return found;
};
const html = (p: StaticPage): string =>
  plain([p.lead, ...[...p.sections, ...(p.nav ? [p.nav] : [])].map((s) => s.heading + s.html)].join(" "));

describe("monthly reports", () => {
  it("cover the last 24 complete months, in both languages, plus a list", () => {
    expect(reportMonths(site)).toHaveLength(23);
    expect(reportMonths(site)[0]).toBe(REPORTS_FROM); // September and October 2024 are before the reports began
    expect(reportMonths(site).at(-1)).toBe("2026-09"); // October is only half reported
    const pages = reportPages(site);
    expect(pages).toHaveLength(2 * 24);
    expect(report("/izvjestaji/2026-09/").alternatePath).toBe("/en/reports/2026-09/");
    expect(report("/izvjestaji/").alternatePath).toBe("/en/reports/");
  });

  it("move between months, years included", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-10", -12)).toBe("2025-10");
    expect(monthName("hr", "2026-10")).toBe("listopad 2026.");
    expect(inMonth("hr", "2026-11")).toBe("U studenome 2026.");
    expect(monthName("en", "2026-02")).toBe("February 2026");
  });

  it("open with a citable sentence against the month before and the same month a year earlier", () => {
    // (600×24 + 200×11 + 100×48 + 100×490) / 1 000 = 70.4 g/kWh
    expect(plain(report("/izvjestaji/2026-09/").lead)).toContain(
      "U rujnu 2026. obnovljivi izvori dali su 90 % proizvodnje struje u Hrvatskoj (kolovoz 2026.: 75 %, rujan 2025.: 55 %), uz CO₂ intenzitet od oko 70 g/kWh.",
    );
    expect(report("/en/reports/2026-09/").lead).toContain(
      "In September 2026, renewable sources provided 90% of Croatia&#39;s electricity (August 2026: 75%, September 2025: 55%), with a carbon intensity of about 70 g/kWh.",
    );
    // the first report compares with a month outside the 24, and has no year-earlier month
    expect(plain(report("/izvjestaji/2024-11/").lead)).toContain("(listopad 2024.: 50 %)");
    const i18n = createI18n("hr");
    expect(plain(report("/izvjestaji/2026-09/").lead)).toContain(
      plain(
        `Ukupna proizvodnja: ${i18n.energy(1_000)}; potrošnja (opterećenje mreže): ${i18n.energy(1_200)}.`,
      ),
    );
  });

  it("show the sources against the two earlier months, and the region", () => {
    const page = report("/izvjestaji/2026-09/");
    // the month in a few points comes first, each one a figure from the tables under it
    expect(page.sections[0]?.heading).toBe("Ukratko");
    const brief = plain(page.sections[0]?.html ?? "");
    expect(brief).toContain("<li>Glavni izvor struje u Hrvatskoj: Hidro (60 % proizvodnje).</li>");
    expect(brief).toContain(
      "<li>Obnovljivi izvori dali su 90 % proizvodnje, 35 post. bodova više nego isti mjesec godinu ranije (55 %).</li>",
    );
    expect(brief).toContain("oko 70 g/kWh (izračun iz faktora IPCC-a, ne mjerenje)");
    expect(brief).toContain("<p>Slobodno dijeljenje uz navođenje izvora: gridatlas.eu.</p>");
    const sources = plain(page.sections[1]?.html ?? "");
    expect(sources).toContain(
      "<th>Izvor</th><th>rujan 2026.</th><th>Udio</th><th>kolovoz 2026.</th><th>rujan 2025.</th>",
    );
    expect(sources.indexOf("Hidro")).toBeLessThan(sources.indexOf("Plin"));
    expect(sources).toContain(`<td class="num">60 %</td>`);
    expect(sources).toContain("<td>Udio obnovljivih</td>");
    const region = plain(page.sections[2]?.html ?? "");
    expect(page.sections[2]?.heading).toBe("Regija: rujan 2026.");
    expect(region.indexOf("Hrvatska")).toBeLessThan(region.indexOf("Slovenija"));
    expect(region).toContain(`<a href="/zemlja/si/">Slovenija</a></td>`);
    expect(region).toContain(
      "Bez potpunih podataka: Mađarska, Srbija, Bosna i Hercegovina, Crna Gora, Italija, Austrija.",
    );
    // Slovenia has no other complete month: in August only Croatia
    expect(plain(report("/izvjestaji/2026-08/").sections[2]?.html ?? "")).not.toContain("Slovenija</a>");
  });

  it("mention a HEP ODS release in the month it came out, and link the months to each other", () => {
    const text = html(report("/izvjestaji/2026-09/"));
    expect(text).toContain("HEP ODS je 20. rujna 2026. objavio nove podatke (stanje 1. rujna 2026.)");
    // "od 3 trafostanice": the noun agrees with the number (Faza 31)
    expect(text).toContain("slobodnog kapaciteta za priključenje ima 2 od 3 trafostanice.");
    expect(html(report("/izvjestaji/2026-08/"))).not.toContain("HEP ODS je");
    expect(text).toContain(`href="/izvjestaji/2026-08/">Prethodni: kolovoz 2026.`);
    expect(text).not.toContain("Sljedeći:");
    expect(html(report("/izvjestaji/2024-11/"))).toContain(
      `href="/izvjestaji/2024-12/">Sljedeći: prosinac 2024.`,
    );
    const dataset = report("/en/reports/2026-09/").jsonLd[0] as {
      temporalCoverage: string;
      isBasedOn: string[];
    };
    expect(dataset.temporalCoverage).toBe("2026-09");
    expect(dataset.isBasedOn).toContain("https://kapaciteti.hep.hr/");
    expect(report("/izvjestaji/2026-09/").breadcrumbs.map((c) => c.path)).toContain("/izvjestaji/");
  });

  it("list every report newest first, with Eurostat's yearly share there and not on the reports", () => {
    const withShares = bareSite({ energy, renewables: SAMPLE_RENEWABLES });
    const index = html(report("/izvjestaji/", withShares));
    expect(index.indexOf("/izvjestaji/2026-09/")).toBeLessThan(index.indexOf("/izvjestaji/2026-08/"));
    expect(index).toContain(
      "Zadnji službeni udio obnovljivih izvora u bruto konačnoj potrošnji energije u Hrvatskoj (Eurostat, 2024.): 34,1 %; cilj za 2030.: 42,5 %.",
    );
    expect(html(report("/izvjestaji/2026-09/", withShares))).not.toContain("Eurostat, 2024.");
  });

  it("are linked from the home page, the transition page and llms.txt, and convert to Markdown", () => {
    expect(homeBody(site, "hr")).toContain(`href="/izvjestaji/"`);
    const transition = transitionPages(site).find((p) => p.lang === "hr");
    expect(transition && html(transition)).toContain(
      `href="/izvjestaji/2026-09/">Zadnji mjesečni izvještaj: rujan 2026.</a>`,
    );
    expect(reportLinks(site, "en")).toEqual([
      `<a href="/en/reports/">Monthly reports: electricity in Croatia and the region</a>`,
    ]);
    expect(llmsTxt(site)).toContain("/en/reports/2026-09/");
    expect(buildPages(site).filter((p) => p.path.startsWith("/izvjestaji/"))).toHaveLength(24);
    const md = pageMarkdown(report("/izvjestaji/2026-09/"), site);
    expect(md).not.toMatch(/<[a-z][^>]*>/);
    expect(md).toContain("# Struja u Hrvatskoj i regiji: rujan 2026.");
  });

  it("put the newest three in the feed, dated by the day their content last changed", () => {
    const entries = reportFeedEntries(site, "hr", new Map([["/izvjestaji/2026-09/", "2026-10-05"]]));
    expect(entries.map((entry) => entry.link)).toEqual([
      "https://karta.example/izvjestaji/2026-09/",
      "https://karta.example/izvjestaji/2026-08/",
      "https://karta.example/izvjestaji/2026-07/",
    ]);
    expect(entries[0]?.updated).toBe("2026-10-05T00:00:00Z");
    expect(entries[1]?.updated).toBe(site.current.createdAt);
    // a feed even without a change report
    const feed = atomFeed(site, null, "hr", entries) ?? "";
    expect(feed).toContain("<id>https://karta.example/izvjestaji/2026-09/</id>");
    expect(feed).toContain("<updated>2026-10-05T00:00:00.000Z</updated>");
    expect(atomFeed(site, null, "hr")).toBeNull();
    // and the pages announce it (Faza 31: only a change report used to)
    expect(hasFeed(site)).toBe(true);
    expect(hasFeed(bareSite())).toBe(false);
  });

  it("are dated by ENTSO-E's last update, not by the weekly map release", () => {
    const dated = bareSite({ energy, energyUpdatedAt: "2026-11-15T05:10:00Z" });
    expect(report("/izvjestaji/2026-09/", dated).lastModified).toBe("2026-11-15T05:10:00Z");
    expect(report("/izvjestaji/2026-09/").lastModified).toBe(site.current.createdAt);
  });

  it("do not exist without Croatia's monthly data", () => {
    expect(reportPages(bareSite())).toEqual([]);
    expect(reportLinks(bareSite(), "hr")).toEqual([]);
    expect(homeBody(bareSite(), "hr")).not.toContain("/izvjestaji/");
  });

  it("keep a report's hash when the next month arrives, and never drop an old one", () => {
    const august = report("/izvjestaji/2026-08/");
    const september = report("/izvjestaji/2026-09/");
    // October completes: September gains a "next" link, and neither report counts as changed
    const later = JSON.parse(JSON.stringify(energy)) as Periods;
    const hr = later.countries.HR?.months;
    if (!hr) throw new Error("no months");
    hr.coverage.generation = hr.coverage.generation.map(() => 1);
    const withOctober = bareSite({ energy: later, capacityHistory });
    const septemberLater = report("/izvjestaji/2026-09/", withOctober);
    expect(html(septemberLater)).toContain("Sljedeći: listopad 2026.");
    expect(pageHash(septemberLater)).toBe(pageHash(september));
    expect(pageHash(report("/izvjestaji/2026-08/", withOctober))).toBe(pageHash(august));
    expect(reportMonths(withOctober)[0]).toBe(REPORTS_FROM);
  });
});
