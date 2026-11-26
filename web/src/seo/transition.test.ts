import { SOURCE_TERMS } from "./license";
import { describe, expect, it } from "vitest";

import type { Current } from "../data/current";
import type { Periods } from "../data/energy";
import { RELEASE } from "../data/hep.fixture";
import { SAMPLE_TIMELINE } from "../data/timeline.fixture";
import { homeBody } from "./home";
import { pageMarkdown } from "./markdown";
import { buildPages, PATHS, type SiteData, type StaticPage } from "./pages";
import { llmsTxt } from "./sitemap";
import {
  hasTransition,
  monthlyIntensity,
  officialSections,
  renewableCapacity,
  RES_TARGET_2030,
  transitionPages,
} from "./transition";
import { TRANSITION_COPY } from "./transitionCopy";
import { bareSite, SAMPLE_CURRENT } from "./site.fixture";
import { SAMPLE_RENEWABLES } from "../data/eurostat.fixture";
import type { Renewables } from "../data/eurostat";
import { createI18n } from "../i18n";

const current: Current = SAMPLE_CURRENT;

const block = (periods: string[], generation: Record<string, (number | null)[]>, coverage: number[]) => ({
  periods,
  generation,
  consumption: {},
  load: periods.map(() => null),
  coverage: { generation: coverage, load: coverage },
});

/** Invented MWh: 2024 and 2025 complete, 2026 not; two complete months and one half month. */
const energy: Periods = {
  version: 1,
  unit: "MWh",
  countries: {
    HR: {
      months: block(
        ["2026-08", "2026-09", "2026-10"],
        { hydro: [500, 400, 100], gas: [500, 600, 900], pumped_storage: [50, 50, 50] },
        [1, 1, 0.5],
      ),
      years: block(
        ["2024", "2025", "2026"],
        { hydro: [6_000, 6_500, 4_000], wind: [2_000, 2_500, 1_500], gas: [2_000, 1_000, 900] },
        [1, 1, 0.85],
      ),
    },
  },
};

const site: SiteData = {
  siteUrl: "https://karta.example",
  dataBaseUrl: "https://podaci.example/",
  current,
  stats: {
    version: 1,
    voltageClasses: [],
    note: "",
    plants: {
      HR: {
        solar: {
          operating: { count: 10, capacityMw: 300, withCapacity: 10 },
          planned: { count: 5, capacityMw: 600, withCapacity: 5 },
        },
        gas: { construction: { count: 1, capacityMw: 200, withCapacity: 1 } },
      },
    },
    substations: {},
    lineKm: {},
  },
  index: { version: 1, fields: ["id", "name", "layer", "country", "lon", "lat", "detail"], rows: [] },
  cities: null,
  diff: null,
  capacity: RELEASE,
  energy,
  timeline: SAMPLE_TIMELINE,
};

const page = (lang: "hr" | "en"): StaticPage => {
  const found = transitionPages(site).find((p) => p.lang === lang);
  if (!found) throw new Error("no page");
  return found;
};
/** Intl writes non-breaking spaces before "%" and in numbers (L-052); compare with plain spaces. */
const plain = (value: string): string => value.replace(/[\u00a0\u202f]/g, " ");
const text = (p: StaticPage): string =>
  plain([p.lead, ...p.sections.map((s) => s.heading + s.html)].join(" "));

describe("energy transition page", () => {
  it("sits under Croatia in the trail (Faza 58-A)", () => {
    expect(page("hr").breadcrumbs.map((crumb) => crumb.path)).toEqual(["/", "/zemlja/hr/"]);
    expect(page("en").breadcrumbs.map((crumb) => crumb.path)).toEqual(["/en/", "/en/country/hr/"]);
  });

  it("exists in both languages, each pointing at the other", () => {
    expect(page("hr").path).toBe("/zelena-tranzicija/");
    expect(page("hr").alternatePath).toBe("/en/energy-transition/");
    expect(page("en").path).toBe(PATHS.en.transition);
  });

  it("leads with citable sentences from the latest complete figures", () => {
    // 2025: (6 500 + 2 500) / 10 000 = 90 %; 2024: 8 000 / 10 000 = 80 %
    expect(plain(page("hr").lead)).toContain(
      "U 2025. obnovljivi izvori dali su 90 % proizvodnje struje u Hrvatskoj (2024.: 80 %).",
    );
    expect(page("en").lead).toContain(
      "In 2025, renewable sources made 90% of Croatia&#39;s electricity (2024: 80%).",
    );
    // September: (400×24 + 600×490) / 1 000 = 303.6; pumped storage is not counted; October is incomplete
    expect(plain(page("hr").lead)).toContain("(rujan 2026.): oko 304 g/kWh");
  });

  it("repeats the lead's figures as tiles, and draws the yearly share and the CO₂ (Faza 54-3)", () => {
    const hr = page("hr");
    const figures = plain(hr.figures ?? "");
    expect(figures).toContain("Obnovljivi u proizvodnji struje");
    expect(figures).toContain('<p class="big">90<small>%</small></p>');
    // 90 % in 2025 against 80 % in 2024: ten points up, good news
    expect(figures).toMatch(/delta good"><b aria-hidden="true">▲<\/b> 10 p\. b\.<\/span> prema 2024\./);
    expect(figures).toContain('<p class="big">304<small>g/kWh</small></p>');
    const share = hr.sections.find((s) => s.heading.startsWith("Udio obnovljivih"))?.html ?? "";
    expect(share).toContain('<div class="columns" aria-hidden="true">');
    expect(share).toContain('<details class="data">');
    const co2 = hr.sections.find((s) => s.heading.startsWith("CO₂"))?.html ?? "";
    expect(co2).toContain('<div class="columns neutral" aria-hidden="true">');
  });

  it("counts only complete months and leaves storage out of the carbon intensity", () => {
    expect(monthlyIntensity(site).map((m) => [m.month, Math.round(m.value)])).toEqual([
      ["2026-08", 257],
      ["2026-09", 304],
    ]);
  });

  it("reads installed renewable capacity from the timeline", () => {
    expect(renewableCapacity(SAMPLE_TIMELINE, 1962)).toEqual({ hydro: 576, wind: 0, solar: 0, other: 0 });
  });

  it("shows what is built, what closed, the grid and the target with its caveat", () => {
    const hr = text(page("hr"));
    expect(hr).toContain("U izgradnji i planirano u Hrvatskoj: 800 MW, od toga 75 % iz obnovljivih izvora.");
    expect(hr).toContain("TE Plomin 1: 1962.–1964., 125 MW");
    expect(hr).toMatch(/slobodnog kapaciteta za priključenje ima \d+ od \d+ trafostanica/);
    expect(hr).toContain("42,5 %");
    expect(hr).toContain("Metodologija i ograničenja");
    const dataset = page("en").jsonLd[0] as { "@type": string; variableMeasured: unknown[] };
    expect(dataset["@type"]).toBe("Dataset");
    expect(dataset.variableMeasured).toHaveLength(5);
    expect((dataset as { license?: unknown }).license).toEqual([
      SOURCE_TERMS.entsoe,
      SOURCE_TERMS.osm,
      SOURCE_TERMS.ccBy,
      SOURCE_TERMS.hepOds,
    ]);
  });

  it("is linked from the home page, Croatia's page and llms.txt, and converts cleanly to Markdown", () => {
    expect(homeBody(site, "hr")).toContain(`href="/zelena-tranzicija/"`);
    const croatia = buildPages(site).find((p) => p.path === PATHS.hr.country("hr"));
    expect(croatia && text(croatia)).toContain(`href="/zelena-tranzicija/"`);
    expect(llmsTxt(site)).toContain("/en/energy-transition/");
    const md = pageMarkdown(page("hr"), site);
    expect(md).not.toMatch(/<[a-z][^>]*>/);
    expect(md).toContain("# Zelena tranzicija u Hrvatskoj");
  });

  it("has no page without generation or timeline data for Croatia", () => {
    const bare: SiteData = { ...site, energy: null, timeline: null };
    expect(hasTransition(bare)).toBe(false);
    expect(transitionPages(bare)).toEqual([]);
    expect(homeBody(bare, "hr")).not.toContain("/zelena-tranzicija/");
  });
});

describe("official renewable share (Eurostat) on the transition page", () => {
  const withShares: SiteData = { ...site, renewables: SAMPLE_RENEWABLES };
  const official = (lang: "hr" | "en", data: SiteData = withShares): StaticPage => {
    const found = transitionPages(data).find((p) => p.lang === lang);
    if (!found) throw new Error("no page");
    return found;
  };
  const section = (p: StaticPage, heading: RegExp): string => {
    const found = p.sections.find((s) => heading.test(s.heading));
    if (!found) throw new Error(`no section ${String(heading)}`);
    return plain(found.html);
  };
  /** Croatia's overall share in 2024 replaced, to test the sentence about the target */
  const croatia2024 = (value: number): Renewables => {
    const ren = [...(SAMPLE_RENEWABLES.series.HR?.REN ?? [])];
    ren[ren.length - 1] = value;
    const hr = { ...SAMPLE_RENEWABLES.series.HR, REN: ren };
    return { ...SAMPLE_RENEWABLES, series: { ...SAMPLE_RENEWABLES.series, HR: hr } };
  };

  it("leads with Eurostat's share and the 2030 target, before the electricity figures", () => {
    expect(plain(official("hr").lead)).toMatch(
      /^<p>Prema Eurostatu, obnovljivi izvori činili su 34,1 % bruto konačne potrošnje energije u Hrvatskoj u 2024\. \(cilj za 2030\.: 42,5 %\)\.<\/p><p>U 2025\. obnovljivi izvori dali su 90 %/,
    );
    expect(official("en").lead).toContain(
      "According to Eurostat, renewable sources made up 34.1% of Croatia&#39;s gross final energy consumption in 2024 (2030 target: 42.5%).",
    );
    expect(
      official("hr")
        .sections.map((s) => s.heading)
        .slice(0, 2),
    ).toEqual(["Službeni udio obnovljivih izvora (Eurostat)", "Usporedba sa susjedima i EU-om (2024.)"]);
  });

  it("shows the gap to the target in points, Croatia's last ten years with flags, and the source", () => {
    const hr = section(official("hr"), /^Službeni udio/);
    // 42.5 − 34.1 = 8.4: "postotna boda", as Croatian agrees with the last digit
    expect(hr).toContain(
      "U 2024. obnovljivi izvori činili su 34,1 % bruto konačne potrošnje energije u Hrvatskoj (EU-27: 25 %). Do cilja od 42,5 % za 2030. nedostaje 8,4 postotna boda.",
    );
    expect(hr).toContain('<th scope="row">2015</th>');
    expect(hr).not.toContain('<th scope="row">2014</th>');
    expect(hr).toContain(`<td class="num">34,1 % (p)</td>`);
    expect(hr).toContain(`<td class="num">8 % (b)</td>`);
    expect(hr).toContain("Oznake Eurostata: b – prekid vremenske serije, p – privremeno.");
    expect(hr).toContain(
      `Izvor: <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_ind_ren/default/table">Eurostat, nrg_ind_ren</a> (CC BY 4.0), Eurostat ažurirao 9. siječnja 2026.</p>`,
    );
    // why "Struja" here is not the share of generation further down
    expect(hr).toContain(
      "svodi se na prosječnu godinu, a obnovljiva struja dijeli se s bruto konačnom potrošnjom struje",
    );
    const en = section(official("en"), /^Official renewable share/);
    expect(en).toContain("That is 8.4 percentage points short of the 2030 target of 42.5%.");
    expect(en).toContain("Eurostat&#39;s flags: b – break in time series, p – provisional.");
    expect(en).toContain("updated by Eurostat on 9 January 2026.</p>");
  });

  it("compares the region in Croatia's latest year, with the year of an older value in brackets", () => {
    const hr = section(official("hr"), /^Usporedba/);
    const order = ["Bosna i Hercegovina", "Hrvatska", "Slovenija", "EU-27"].map((name) => hr.indexOf(name));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(hr).toContain(
      `<a href="/zemlja/ba/">Bosna i Hercegovina</a></th><td class="num">49 % (2023.)</td>`,
    );
    expect(hr).toContain("Zemlje bez Eurostatovih udjela: Mađarska, Srbija, Crna Gora, Italija, Austrija.");
    expect(hr).toContain("Gdje za 2024. nema podatka, u zagradi je godina zadnjeg podatka.");
    expect(section(official("en"), /^Compared/)).toContain(`<td class="num">49% (2023)</td>`);
  });

  it("says when the target is reached, and words a gap of 1.1 points in the singular", () => {
    // 42,47 % is shown as 42,5 %: the page then says the target is reached, never "0 points short"
    const rounded = officialSections(croatia2024(42.47), "hr");
    expect(rounded && plain(rounded.sections[0]?.html ?? "")).toContain(
      "Cilj od 42,5 % za 2030. je dosegnut.",
    );
    const reached = officialSections(croatia2024(45), "hr");
    expect(reached && plain(reached.sections[0]?.html ?? "")).toContain(
      "Cilj od 42,5 % za 2030. je dosegnut.",
    );
    const close = officialSections(croatia2024(41.4), "hr");
    expect(close && plain(close.sections[0]?.html ?? "")).toContain("nedostaje 1,1 postotni bod.");
  });

  it("measures the target with the official share and names Eurostat in the method and the data set", () => {
    const hr = text(official("hr"));
    expect(hr).toContain("mjeri se službenim udjelom Eurostata (gore), ne udjelom u proizvodnji struje.");
    expect(hr).toContain("skup podataka nrg_ind_ren");
    // the copy's target and the constant the gap is computed from are the same number
    for (const lang of ["hr", "en"] as const) {
      const target = plain(createI18n(lang).percent(RES_TARGET_2030 / 100));
      expect(plain(TRANSITION_COPY[lang].target.text)).toContain(target);
      expect(plain(TRANSITION_COPY[lang].target.measured)).toContain(target);
    }
    const dataset = official("en").jsonLd[0] as { variableMeasured: unknown[]; isBasedOn: string[] };
    expect(dataset.variableMeasured).toHaveLength(6);
    expect(dataset.isBasedOn[0]).toBe(SAMPLE_RENEWABLES.sourceUrl);
    expect(official("hr").description).toMatch(
      /^Službeni udio obnovljivih izvora prema Eurostatu i cilj za 2030\., /,
    );
    expect(official("hr").description).toMatch(
      / i slobodni kapacitet mreže u Hrvatskoj, iz otvorenih podataka\.$/,
    );
  });

  it("is a page on Eurostat's share alone, converts to Markdown and is in llms.txt", () => {
    const only = bareSite({ renewables: SAMPLE_RENEWABLES });
    expect(hasTransition(only)).toBe(true);
    expect(official("hr", only).sections.map((s) => s.heading)).toEqual([
      "Službeni udio obnovljivih izvora (Eurostat)",
      "Usporedba sa susjedima i EU-om (2024.)",
      "Cilj za 2030.",
      "Metodologija i ograničenja",
    ]);
    const md = pageMarkdown(official("hr"), withShares);
    expect(md).not.toMatch(/<[a-z][^>]*>/);
    expect(md).toContain("## Službeni udio obnovljivih izvora (Eurostat)");
    expect(llmsTxt(withShares)).toContain(
      "official renewable share of gross final energy consumption (Eurostat)",
    );
    expect(llmsTxt(site)).not.toContain("(Eurostat)");
  });

  it("says the count of plants without a year is of every kind, not only the table's renewables (58-B)", () => {
    expect(text(page("hr"))).toContain(
      "Elektrane bez godine puštanja u pogon nisu u tablici; takvih je u pogonu, svih vrsta: 3.",
    );
  });

  it("names in its description and data set only what the page shows (Faza 58-B)", () => {
    const only = official("en", bareSite({ renewables: SAMPLE_RENEWABLES }));
    expect(only.description).toBe(
      "The official renewable share (Eurostat) against the 2030 target in Croatia, from open data.",
    );
    const dataset = only.jsonLd[0] as {
      variableMeasured: { name: string }[];
      isBasedOn: string[];
      license: string[];
    };
    expect(dataset.variableMeasured.map((v) => v.name)).toEqual([
      "renewable share of gross final energy consumption (Eurostat)",
    ]);
    expect(dataset.isBasedOn).toEqual([SAMPLE_RENEWABLES.sourceUrl]);
    expect(dataset.license).toEqual([SOURCE_TERMS.ccBy]);
  });

  it("leaves the official sections out without Croatia's overall share", () => {
    const hr = { ...SAMPLE_RENEWABLES.series.HR, REN: SAMPLE_RENEWABLES.years.map(() => null) };
    const none: Renewables = { ...SAMPLE_RENEWABLES, series: { ...SAMPLE_RENEWABLES.series, HR: hr } };
    expect(officialSections(none, "hr")).toBeNull();
    expect(hasTransition(bareSite({ renewables: none }))).toBe(false);
    const page = official("hr", { ...site, renewables: none });
    expect(page.sections.some((s) => s.heading.startsWith("Službeni"))).toBe(false);
    expect(plain(page.sections.find((s) => s.heading === "Cilj za 2030.")?.html ?? "")).toContain(
      "službenu vrijednost objavljuje Eurostat",
    );
  });
});
