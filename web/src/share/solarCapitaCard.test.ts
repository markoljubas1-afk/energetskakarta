import { describe, expect, it } from "vitest";

import { SAMPLE_SOLAR_CAPITA } from "../data/solarCapita.fixture";
import { SolarCapitaSchema, solarCapitaCountries, standings } from "../data/solarCapita";
import { SCOPE_COUNTRIES } from "../domain";
import { createI18n } from "../i18n";
import { cardSummary, presentable } from "../panels/DayCardDialog";
import { bareSite } from "../seo/site.fixture";
import { solarCapitaSection, solarCapitaSentence } from "../seo/transition";
import { SAMPLE_RENEWABLES } from "../data/eurostat.fixture";
import { askedSolarPicture, solarCapitaCard, solarCapitaCardText } from "./solarCapitaCard";

const hr = createI18n("hr");
const en = createI18n("en");

describe("solar electricity per inhabitant", () => {
  it("ranks the countries in the year they share", () => {
    expect(SolarCapitaSchema.safeParse(SAMPLE_SOLAR_CAPITA).success).toBe(true);
    const rows = standings(SAMPLE_SOLAR_CAPITA);
    expect(rows.map((row) => [row.country, row.place, row.kwhPerPerson])).toEqual([
      ["HU", 1, 962.1],
      ["AT", 2, 887.3],
      ["IT", 3, 610.5],
      ["SI", 4, 596.1],
      ["HR", 5, 212],
      ["BA", 6, 176.2],
      ["ME", 7, 102.2],
      ["RS", 8, 24.7],
    ]);
    expect(rows.every((row) => row.of === 8 && row.year === 2024)).toBe(true);
    expect(rows.find((row) => row.country === "BA")?.flags).toEqual(["p"]);
    expect(rows.find((row) => row.country === "HR")?.previous).toEqual({ year: 2023, kwhPerPerson: 107.1 });
    expect(solarCapitaCountries(SAMPLE_SOLAR_CAPITA, SCOPE_COUNTRIES)).toEqual([...SCOPE_COUNTRIES]);
  });

  it("leaves out a country without the shared year", () => {
    const croatia = SAMPLE_SOLAR_CAPITA.countries.HR ?? [];
    const short = {
      ...SAMPLE_SOLAR_CAPITA,
      countries: { ...SAMPLE_SOLAR_CAPITA.countries, HR: croatia.slice(0, 1) },
    };
    expect(standings(short).map((row) => row.country)).not.toContain("HR");
    expect(solarCapitaCard(short, "HR")).toBeNull();
    expect(solarCapitaSection(short, "hr")).toBeNull();
  });

  it("says Croatia's figure, its place and the change from the year before", () => {
    const card = solarCapitaCard(SAMPLE_SOLAR_CAPITA, "HR");
    if (!card) throw new Error("no card");
    const summary = cardSummary(solarCapitaCardText(card, hr));
    expect(summary).toBe(
      "GridAtlas: Sunčana struja po stanovniku. Hrvatska · 2024.: " +
        "212 kWh sunčane struje po stanovniku (820 GWh iz fotonaponskih elektrana na 3,87 mil. stanovnika); " +
        "5. od 8 mjesto u regiji (prva: Mađarska, 962 kWh); " +
        "+98 % u odnosu na 2023. (tada 107 kWh po stanovniku). " +
        "Izračun GridAtlasa iz podataka Eurostata (nrg_bal_peh, demo_gind) · gridatlas.eu",
    );
    expect(presentable(summary)).toBe(true);
    const english = cardSummary(solarCapitaCardText(card, en));
    expect(english).toContain("212 kWh of solar electricity per inhabitant");
    expect(english).toContain("No. 5 of 8 place in the region (first: Hungary, 962 kWh)");
  });

  it("says so for the country in first place, and marks provisional figures", () => {
    const first = solarCapitaCard(SAMPLE_SOLAR_CAPITA, "HU");
    const bosnia = solarCapitaCard(SAMPLE_SOLAR_CAPITA, "BA");
    if (!first || !bosnia) throw new Error("no card");
    expect(cardSummary(solarCapitaCardText(first, hr))).toContain(
      "1. od 8 mjesto u regiji (najviše u regiji)",
    );
    expect(solarCapitaCardText(bosnia, hr).footer).toContain("dio podataka je privremen");
    // Serbia had 7.0 kWh the year before: a whole number says it
    const serbia = solarCapitaCard(SAMPLE_SOLAR_CAPITA, "RS");
    if (!serbia) throw new Error("no card");
    expect(solarCapitaCardText(serbia, hr).figures[2]?.note).toBe("tada 7 kWh po stanovniku");
  });

  it("is opened by its link only", () => {
    expect(askedSolarPicture("?pic=solarhead")).toBe("solarhead");
    expect(askedSolarPicture("?pic=gas")).toBeNull();
    expect(askedSolarPicture("")).toBeNull();
  });

  it("has its section on the transition page, with both parts of the calculation and their sources", () => {
    const section = solarCapitaSection(SAMPLE_SOLAR_CAPITA, "hr");
    expect(section?.heading).toBe("Sunčana struja po stanovniku");
    const html = section?.html ?? "";
    expect(html).toContain(
      "Fotonaponske elektrane u Hrvatskoj proizvele su 2024. godine 820 GWh struje, što je 212 kWh po stanovniku: " +
        "5. mjesto među 8 zemalja regije. Prva je Mađarska s 962 kWh po stanovniku, 4,5 puta više. " +
        "Godine 2023. bilo je 107 kWh po stanovniku.",
    );
    expect(html).toContain('<td>Hrvatska</td><td class="num">212</td><td class="num">820</td>');
    // Bosnia and Herzegovina's population carries Eurostat's flag, and the flag is explained
    expect(html).toContain("3.411.829 (p)");
    expect(html).toContain("p – ");
    expect(html).toContain('href="https://ec.europa.eu/eurostat/databrowser/view/nrg_bal_peh/default/table"');
    expect(html).toContain('href="https://ec.europa.eu/eurostat/databrowser/view/demo_gind/default/table"');
    expect(html).toContain("pic=solarhead");
    expect(solarCapitaSection(SAMPLE_SOLAR_CAPITA, "en")?.html).toContain(
      "place 5 among the 8 countries of the region. Hungary is first with 962 kWh per inhabitant, 4.5 times as much.",
    );
  });

  it("is one sentence on a country's own page, leading to the comparison", () => {
    const site = bareSite({ renewables: SAMPLE_RENEWABLES, solarCapita: SAMPLE_SOLAR_CAPITA });
    expect(solarCapitaSentence(site, "hr", "SI")).toBe(
      "<p>Sunčana struja po stanovniku: 596 kWh u 2024. godini (1.268 GWh iz fotonaponskih elektrana), " +
        '4. mjesto među 8 zemalja regije. <a href="/zelena-tranzicija/">Usporedba zemalja i izvori</a>.</p>',
    );
    expect(solarCapitaSentence(site, "en", "RS")).toContain(
      "25 kWh in 2024 (163 GWh from photovoltaic plants), place 8 among the 8",
    );
    // nothing without the document, and no link to a page that does not exist
    expect(solarCapitaSentence(bareSite({ renewables: SAMPLE_RENEWABLES }), "hr", "SI")).toBe("");
    expect(solarCapitaSentence(bareSite({ solarCapita: SAMPLE_SOLAR_CAPITA }), "hr", "SI")).toBe("");
  });
});
