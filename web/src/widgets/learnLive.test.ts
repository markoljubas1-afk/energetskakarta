import { describe, expect, it } from "vitest";

import { GREEN_LIVE } from "../data/greenShare.fixture";
import type { Households } from "../data/households";
import { LEARN_COPY, learnPage } from "../seo/learnPages";
import { bareSite } from "../seo/site.fixture";
import { fill, nowFigures } from "./learnLive";

/** Croatia's latest reported hour in the fixture is 09:00 to 10:00: 900 of 1300 MW renewable, 69 %. */
const SOON_AFTER = new Date("2026-11-16T11:20:00+01:00");
const EVENING = new Date("2026-11-16T20:30:00+01:00");

/** Invented: Croatia's households used 6,570 GWh in 2023, 750 MW on average. */
const HOUSEHOLDS: Households = {
  version: 1,
  dataset: "nrg_d_hhq",
  source: "Eurostat",
  sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/nrg_d_hhq/default/table",
  license: "CC-BY-4.0",
  unit: "GWh",
  updated: null,
  retrievedAt: "2026-11-17T14:00:00+00:00",
  years: [2023],
  series: { HR: [6570] },
  missing: [],
};

const priced = (eur: number) => {
  const eurPerMwh: (number | null)[] = GREEN_LIVE.hours.map(() => null);
  eurPerMwh[33] = eur;
  return { ...GREEN_LIVE, prices: { HR: { zone: "10YHR-HEP------M", eurPerMwh } } };
};

/** The box exactly as the learning page renders it. */
function box(): HTMLElement {
  const html = learnPage(bareSite(), "hr")
    .sections.map((section) => section.html)
    .join("");
  document.body.innerHTML = html;
  const found = document.querySelector<HTMLElement>("[data-live-now]");
  if (!found) throw new Error("the learning page has no live box");
  return found;
}

describe("the learning page's live box", () => {
  it("computes the same figures as the map's green card", () => {
    const figures = nowFigures(priced(84.5), HOUSEHOLDS, "HR", SOON_AFTER);
    expect(figures).toMatchObject({ band: "high", stale: false, price: 84.5, renewableMw: 900 });
    expect(figures?.share).toBeCloseTo(900 / 1300, 6);
    expect(figures?.households).toMatchObject({ averageMw: 750, year: 2023 });
    expect(figures?.households?.ratio).toBeCloseTo(1.2, 6);
    // by the evening the same hour is no longer "now"; a country that reports nothing has no figures
    expect(nowFigures(GREEN_LIVE, null, "HR", EVENING)).toMatchObject({
      stale: true,
      price: null,
      households: null,
    });
    expect(nowFigures(GREEN_LIVE, null, "ME", SOON_AFTER)).toBeNull();
  });

  it("is rendered hidden, with its words and empty slots, and carries where to read the data", () => {
    const element = box();
    expect(element.hidden).toBe(true);
    expect(element.dataset).toMatchObject({ country: "HR", lang: "hr" });
    expect(element.dataset.base).toBe(bareSite().dataBaseUrl);
    expect(element.textContent).toContain(LEARN_COPY.hr.now.title);
    expect(document.querySelector('script[type="module"][src="/learn-live.js"]')).not.toBeNull();
  });

  it("fills the slots, shows the sentence that fits and colours the box by the share", () => {
    const element = box();
    const figures = nowFigures(priced(84.5), HOUSEHOLDS, "HR", SOON_AFTER);
    if (!figures) throw new Error("fixture");
    fill(element, figures, "hr");

    expect(element.hidden).toBe(false);
    expect(element.dataset.band).toBe("high");
    expect(element).toHaveTextContent("69 % proizvodnje je iz obnovljivih izvora");
    const top = element.querySelector<HTMLElement>('[data-part="top"]');
    expect(top?.hidden).toBe(false);
    expect(top).toHaveTextContent(/^Najveći izvor u tom satu: [a-zčćšžđ ]+, \d+ % proizvodnje\.$/);
    const price = element.querySelector<HTMLElement>('[data-part="price"]');
    expect(price?.hidden).toBe(false);
    expect(price).toHaveTextContent("Cijena na burzi (dan unaprijed): 84,5 €/MWh");
    expect(price?.dataset.free).toBe("false");
    const times = element.querySelector<HTMLElement>('[data-part="times"]');
    expect(times?.hidden).toBe(false);
    expect(times).toHaveTextContent(
      "Obnovljivi izvori daju 900 MW: 1,2 puta više nego što sva kućanstva u zemlji troše u prosjeku (750 MW, 2023.).",
    );
    expect(element.querySelector<HTMLElement>('[data-part="share"]')?.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>('[data-part="stale"]')?.hidden).toBe(true);
  });

  it("says so when the price is zero or below, and takes the colour off an old figure", () => {
    const element = box();
    const free = nowFigures(priced(-3.2), null, "HR", SOON_AFTER);
    if (!free) throw new Error("fixture");
    fill(element, free, "hr");
    expect(element.querySelector<HTMLElement>('[data-part="price"]')?.dataset.free).toBe("true");
    // without Eurostat's figure neither sentence about households is shown
    expect(element.querySelector<HTMLElement>('[data-part="times"]')?.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>('[data-part="share"]')?.hidden).toBe(true);

    const old = nowFigures(GREEN_LIVE, null, "HR", EVENING);
    if (!old) throw new Error("fixture");
    fill(box(), old, "hr");
    const stale = document.querySelector<HTMLElement>("[data-live-now]");
    expect(stale?.dataset.band).toBe("stale");
    expect(stale?.querySelector<HTMLElement>('[data-part="stale"]')?.hidden).toBe(false);
  });
});
