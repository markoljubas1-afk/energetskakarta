import { SOURCE_TERMS } from "./license";
import { describe, expect, it } from "vitest";

import { GasFlowsSchema, type GasFlows } from "../data/gasFlows";
import { GasStorageSchema, type GasStorage } from "../data/gasStorage";
import { gasLinks, gasPages, hasGasPage } from "./gasPages";
import { buildPages } from "./pages";
import { bareSite } from "./site.fixture";

const DAYS = [10, 11, 12, 13, 14, 15, 16, 17, 18].map((day) => `2026-11-${String(day)}`);

/** Seven equal days, then the 17th with its own figure, then a day nobody has reported yet. */
const series = (usual: number, last: number): (number | null)[] => [
  ...DAYS.slice(0, 7).map(() => usual * 1e6),
  last * 1e6,
  null,
];

const point = (
  key: string,
  label: string,
  kind: GasFlows["countries"][string]["points"][number]["kind"],
  direction: "entry" | "exit",
  usual: number,
  last: number,
  neighbour: string | null = null,
): GasFlows["countries"][string]["points"][number] => ({
  key,
  label,
  kind,
  direction,
  neighbour,
  kwhPerDay: series(usual, last),
  status: [...DAYS.slice(0, 8).map(() => "P" as const), null],
});

const FLOWS: GasFlows = {
  version: 1,
  generatedAt: "2026-11-19T10:00:00+00:00",
  source: "ENTSOG Transparency Platform",
  sourceUrl: "https://transparency.entsog.eu/",
  unit: "kWh/d",
  days: DAYS,
  countries: {
    HR: {
      operatorKey: "HR-TSO-0001",
      operator: "Plinacro Ltd",
      points: [
        point("LNG-00032", "Croatia LNG", "LNG", "entry", 100, 98.4),
        point("PRD-00197", "Production (HR)", "PRD", "entry", 20, 19.5),
        point("UGS-00028", "UGS Croatia", "UGS", "entry", 0, 3.3),
        point("ITP-00042", "Rogatec", "ITP", "exit", 30, 25.3, "SI"),
        point("FNC-00018", "Final Consumers and Distribution (HR)", "FNC", "exit", 80, 71.9),
      ],
    },
  },
  missing: [],
};

const facility = (
  id: string,
  name: string,
  country: string,
  full: number,
  twh: number,
  status: string,
): GasStorage["facilities"][number] => ({
  id,
  name,
  operator: "operator",
  operatorId: "op",
  country,
  lon: 16.4,
  lat: 45.6,
  workingGasTwh: 5,
  status: DAYS.map(() => status),
  fullPercent: DAYS.map(() => full),
  inStorageTwh: DAYS.map(() => twh),
  injectionGwhPerDay: DAYS.map(() => 0),
  withdrawalGwhPerDay: DAYS.map(() => 5),
});

const STORAGE: GasStorage = {
  version: 1,
  generatedAt: "2026-11-19T19:30:00+00:00",
  source: "GIE AGSI",
  sourceUrl: "https://agsi.gie.eu/",
  attribution: "GIE AGSI",
  license: "GIE",
  days: DAYS,
  facilities: [
    facility("okoli", "PSP Okoli", "HR", 82.5, 3.94, "C"),
    facility("hu", "Zsana", "HU", 77.1, 16.2, "E"),
  ],
  missing: { facilities: [], countries: [] },
};

const site = bareSite({ gasFlows: FLOWS, gasStorage: STORAGE });
const page = (lang: "hr" | "en") => {
  const found = gasPages(site).find((each) => each.lang === lang);
  if (!found) throw new Error("no gas page");
  return found;
};
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"');

describe("the gas page", () => {
  it("reads fixtures the app would read", () => {
    expect(GasFlowsSchema.safeParse(FLOWS).success).toBe(true);
    expect(GasStorageSchema.safeParse(STORAGE).success).toBe(true);
  });

  it("opens with the day's three figures, each a sentence that stands on its own", () => {
    const hr = page("hr");
    expect(hr.path).toBe("/plin/");
    expect(hr.alternatePath).toBe("/en/gas/");
    expect(text(hr.lead)).toBe(
      " Plinskog dana 17. studenoga 2026. u hrvatski transportni sustav ušlo je 121,2 GWh plina, a najviše na ulazu „LNG terminal”: 98,4 GWh (81 %). " +
        "Kupcima i distribuciji u Hrvatskoj isporučeno je plinskog dana 17. studenoga 2026. ukupno 71,9 GWh plina. " +
        "Prosjek prethodnih sedam plinskih dana bio je 80 GWh, pa je to 10 % manje od prosjeka. " +
        // the storage has reported a day more than the transmission system
        "Skladište plina PSP Okoli bilo je plinskog dana 18. studenoga 2026. puno 82,5 % (3,94 TWh plina). " +
        "Podaci operatora za taj dan još su privremeni. ",
    );
    expect(hr.title.length).toBeLessThanOrEqual(60);
    expect(hr.description.length).toBeLessThanOrEqual(155);
    expect(hr.lastModified).toBe("2026-11-19T10:00:00+00:00");
  });

  it("answers its questions with tables of the same day", () => {
    const hr = page("hr");
    expect(hr.sections.map((section) => section.heading)).toEqual([
      "Odakle Hrvatskoj dolazi plin?",
      "Kamo plin odlazi iz sustava?",
      "Koliko se plina isporuči kupcima u Hrvatskoj po danu?",
      "Koliko je puno skladište plina Okoli?",
      "Gdje su LNG terminal, plinovodi i bušotine na karti?",
      "Više o plinu",
      "Što ove brojke jesu, a što nisu?",
    ]);
    const [from, to, perDay, storage, onMap, more] = hr.sections.map((section) => section.html);
    expect(from).toContain('<td>LNG terminal</td><td class="num">98,4</td><td class="num">81 %</td>');
    expect(to).toContain("izašlo je 97,2 GWh plina");
    expect(to).toContain("Rogatec (Slovenija)");
    // eight reported days, the latest first; the unreported 18th is not there
    expect(perDay?.match(/<tr>/g)?.length).toBe(9);
    expect(perDay).toContain(
      '<td>17. studenoga 2026.</td><td class="num">71,9</td><td class="num">121,2</td>',
    );
    expect(perDay).not.toContain("18. studenoga");
    expect(storage).toContain("<td>Zsana</td>");
    expect(storage).toContain("GIE AGSI");
    expect(onMap).toContain("l=gas%2Cpipelines");
    expect(more).toContain('href="/edukacija/"');
    expect(more).toContain("pic=gasflow");
  });

  it("shows the day as tiles and charts, with the tables behind a click (Faza 54-3)", () => {
    const hr = page("hr");
    const figures = hr.figures ?? "";
    expect(figures).toContain('<p class="big">121,2<small>GWh</small></p>');
    // the customers' day against their usual week: neither good nor bad news
    expect(figures).toMatch(
      /delta neutral"><b aria-hidden="true">▼<\/b> [\d,]+\s%<\/span> prema prosjeku 7 dana/,
    );
    expect(figures).toContain("Skladište PSP Okoli");
    expect(figures).toContain('<p class="big">82,5<small>%</small></p>');
    const [from, , perDay, storage] = hr.sections.map((section) => section.html);
    expect(from).toContain('<div class="ranking">');
    expect(from).toContain('<details class="data"><summary>Tablica s brojkama</summary>');
    expect(perDay).toContain('<div class="columns neutral" aria-hidden="true">');
    expect(perDay).toContain('<span class="cur">17. 11.</span>');
    expect(storage).toContain('<div class="rrow own">');
  });

  it("carries the same sentences as FAQ structured data, and a dated dataset", () => {
    const hr = page("hr");
    const faq = hr.jsonLd.find((each) => each["@type"] === "FAQPage") as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(faq.mainEntity.map((each) => each.name)).toEqual(
      hr.sections.slice(0, 4).map((each) => each.heading),
    );
    for (const [at, each] of faq.mainEntity.entries()) {
      expect(text(hr.sections[at]?.html ?? "")).toContain(each.acceptedAnswer.text);
    }
    const dataset = hr.jsonLd.find((each) => each["@type"] === "Dataset");
    expect(dataset).toMatchObject({
      temporalCoverage: "2026-11-17",
      dateModified: "2026-11-19T10:00:00+00:00",
      isBasedOn: ["https://transparency.entsog.eu/", "https://agsi.gie.eu/"],
      license: [SOURCE_TERMS.entsog, SOURCE_TERMS.gieAgsi],
    });
  });

  it("is in English too, and among the site's pages", () => {
    const en = page("en");
    expect(text(en.lead)).toContain(
      'On the gas day of 17 November 2026, 121.2 GWh of gas entered Croatia\'s transmission system, most of it at the entry "LNG terminal": 98.4 GWh (81%).',
    );
    expect(text(en.lead)).toContain("so that is 10% less than the average.");
    expect(
      buildPages(site).filter((each) => each.path === "/plin/" || each.path === "/en/gas/"),
    ).toHaveLength(2);
    expect(gasLinks(site, "hr")).toEqual(['<a href="/plin/">Plin u Hrvatskoj: dnevna slika</a>']);
  });

  it("marks an estimate, lives without the storage, and does not exist without a balance", () => {
    const estimated = bareSite({
      gasFlows: FLOWS,
      gasStorage: { ...STORAGE, facilities: [facility("okoli", "PSP Okoli", "HR", 82.5, 3.94, "E")] },
    });
    expect(text(gasPages(estimated)[0]?.lead ?? "")).toContain("procjena platforme");
    const alone = gasPages(bareSite({ gasFlows: FLOWS }))[0];
    expect(alone?.sections.map((section) => section.heading)).not.toContain(
      "Koliko je puno skladište plina Okoli?",
    );
    expect(hasGasPage(bareSite())).toBe(false);
    expect(gasPages(bareSite())).toEqual([]);
    expect(gasLinks(bareSite(), "hr")).toEqual([]);
    const silent = bareSite({ gasFlows: { ...FLOWS, countries: {} } });
    expect(hasGasPage(silent)).toBe(false);
    expect(gasPages(silent)).toEqual([]);
  });
});

describe("section anchors", () => {
  it("give every heading an address of its own", async () => {
    const { anchor, sectionsHtml } = await import("./markup");
    expect(anchor("Odakle Hrvatskoj dolazi plin?")).toBe("odakle-hrvatskoj-dolazi-plin");
    expect(anchor("Što ove brojke jesu, a što nisu?")).toBe("sto-ove-brojke-jesu-a-sto-nisu");
    expect(anchor("Mađarska: CO₂ 2024.")).toBe("madarska-co-2024");
    expect(
      sectionsHtml([
        { heading: "Izvori", html: "<p>a</p>" },
        { heading: "Izvori", html: "<p>b</p>" },
        { heading: "…", html: "" },
      ]),
    ).toBe(
      '<section><h2 id="izvori">Izvori</h2><p>a</p></section>\n' +
        '<section><h2 id="izvori-2">Izvori</h2><p>b</p></section>\n' +
        "<section><h2>…</h2></section>",
    );
    const { renderPage } = await import("./html");
    expect(renderPage(page("hr"), site)).toContain('<h2 id="koliko-je-puno-skladiste-plina-okoli">');
  });
});

describe("a description in a search result", () => {
  it("is whole when it fits, else its leading sentences, else a cut at a word", async () => {
    const { snippet } = await import("./markup");
    expect(snippet("Kratak opis.")).toBe("Kratak opis.");
    const two =
      "Otvorena karta elektrana, dalekovoda i trafostanica Hrvatske i regije, s podacima uživo. " +
      "Podaci OpenStreetMap, Global Energy Monitor i ENTSO-E, tjedno ažurirani, pod otvorenom licencom.";
    expect(two.length).toBeGreaterThan(155);
    expect(snippet(two)).toBe(
      "Otvorena karta elektrana, dalekovoda i trafostanica Hrvatske i regije, s podacima uživo.",
    );
    // a decimal point is not the end of a sentence
    expect(snippet("Udio je 34.1 %. " + "x".repeat(200) + ".")).toBe("Udio je 34.1 %.");
    const one = `${"riječ ".repeat(40)}kraj.`;
    const cut = snippet(one);
    expect(cut.length).toBeLessThanOrEqual(155);
    expect(cut.endsWith("riječ…")).toBe(true);
    const { renderPage } = await import("./html");
    const long = { ...page("hr"), description: two };
    expect(renderPage(long, site)).toContain(
      '<meta name="description" content="Otvorena karta elektrana, dalekovoda i trafostanica Hrvatske i regije, s podacima uživo.">',
    );
  });
});

describe("the pages of the terminal and the storage", () => {
  it("say the day's figure of each place, with the learning page's facts and sources", async () => {
    const { gasPlacePages, gasPlaceLinks } = await import("./gasPlaces");
    const pages = gasPlacePages(site);
    expect(pages.map((each) => each.path)).toEqual([
      "/plin/lng-terminal-krk/",
      "/plin/skladiste-plina-okoli/",
      "/en/gas/krk-lng-terminal/",
      "/en/gas/okoli-gas-storage/",
    ]);
    const [terminal, storage] = pages;
    if (!terminal || !storage) throw new Error("no pages");
    expect(terminal.alternatePath).toBe("/en/gas/krk-lng-terminal/");
    expect(text(terminal.lead)).toBe(
      " Plinskog dana 17. studenoga 2026. LNG terminal na Krku poslao je u hrvatski transportni sustav 98,4 GWh plina, 81 % svega što je taj dan ušlo u sustav (121,2 GWh). Podaci operatora za taj dan još su privremeni. ",
    );
    const [perDay, what] = terminal.sections.map((section) => section.html);
    expect(perDay?.match(/<tr>/g)?.length).toBe(9);
    expect(perDay).toContain('<td>16. studenoga 2026.</td><td class="num">100</td><td class="num">83 %</td>');
    expect(what).toContain("Ukapljeni plin (LNG) dolazi brodovima na terminal u Omišlju");
    expect(what).toContain('href="https://sabor.hr/');
    expect(terminal.breadcrumbs.at(-1)).toEqual({ name: "Plin u Hrvatskoj", path: "/plin/" });

    expect(storage.heading).toBe("Skladište plina Okoli (PSP Okoli)");
    expect(text(storage.lead)).toBe(
      " Skladište plina PSP Okoli bilo je plinskog dana 18. studenoga 2026. puno 82,5 %: u njemu je bilo 3,94 TWh plina od 5 TWh koliko stane. Tog se dana praznilo: povučeno je 5 GWh. ",
    );
    expect(storage.sections[0]?.html).toContain("GIE AGSI");
    expect(storage.sections[1]?.html).toContain("Hrvatska ima jedno skladište, Okoli");
    expect(storage.sections[2]?.html).toContain("v=45.60%2C16.40%2C10");
    for (const each of pages) {
      const faq = each.jsonLd.find((ld) => ld["@type"] === "FAQPage") as {
        mainEntity: { acceptedAnswer: { text: string } }[];
      };
      const body = text(each.sections.map((section) => section.html).join(" "));
      for (const question of faq.mainEntity) expect(body).toContain(question.acceptedAnswer.text);
      expect(each.title.length).toBeLessThanOrEqual(60);
    }
    // the gas page leads to both
    expect(gasPlaceLinks(site, "hr")).toHaveLength(2);
    expect(page("hr").sections.find((section) => section.heading === "Više o plinu")?.html).toContain(
      'href="/plin/skladiste-plina-okoli/"',
    );
    expect(buildPages(site).filter((each) => each.path.startsWith("/plin/"))).toHaveLength(3);
  });

  it("exist only while their figures do", async () => {
    const { gasPlacePages } = await import("./gasPlaces");
    expect(gasPlacePages(bareSite())).toEqual([]);
    // no storage document: the terminal's page alone
    expect(gasPlacePages(bareSite({ gasFlows: FLOWS })).map((each) => each.path)).toEqual([
      "/plin/lng-terminal-krk/",
      "/en/gas/krk-lng-terminal/",
    ]);
    // a storage without the flows has no gas page to hang under
    expect(gasPlacePages(bareSite({ gasStorage: STORAGE }))).toEqual([]);
    const hungary = STORAGE.facilities[1];
    if (!hungary) throw new Error("no second facility");
    const abroad = bareSite({ gasFlows: FLOWS, gasStorage: { ...STORAGE, facilities: [hungary] } });
    expect(gasPlacePages(abroad).map((each) => each.path)).not.toContain("/plin/skladiste-plina-okoli/");
  });
});

describe("the picture a shared link shows", () => {
  it("is the topic's own on the gas, transition and report pages, and each file exists", async () => {
    const { existsSync } = await import("node:fs");
    const { OG_TOPIC_IMAGES } = await import("./ogImages");
    for (const byLang of Object.values(OG_TOPIC_IMAGES)) {
      for (const file of Object.values(byLang)) expect(existsSync(`public${file}`), file).toBe(true);
    }
    const { renderPage } = await import("./html");
    expect(renderPage(page("hr"), site)).toContain(
      '<meta property="og:image" content="https://karta.example/og-plin.png">',
    );
    expect(renderPage(page("en"), site)).toContain("https://karta.example/og-gas.png");
    const { gasPlacePages } = await import("./gasPlaces");
    expect(
      gasPlacePages(site).every((each) => each.image?.endsWith(each.lang === "hr" ? "plin.png" : "gas.png")),
    ).toBe(true);
    // a page without a picture of its own keeps the site's
    const plain = { ...page("hr") };
    delete plain.image;
    expect(renderPage(plain, site)).toContain("https://karta.example/og-gridatlas.png");
  });
});
