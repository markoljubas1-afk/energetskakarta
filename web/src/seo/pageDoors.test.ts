import { describe, expect, it } from "vitest";

import { askedSunPoint, LANGS, parseState } from "../state/url";
import { apiPage, authorPage } from "./aboutPages";
import { renderPage } from "./html";
import { pageMarkdown } from "./markdown";
import {
  capacityDoor,
  citiesDoor,
  countryJsonDoor,
  homeDoor,
  homeLink,
  learnDoor,
  mapDoor,
  solarDoor,
} from "./pageDoors";
import { PATHS } from "./site";
import { bareSite } from "./site.fixture";

describe("where the static pages lead", () => {
  it("opens views the map understands, in both languages", () => {
    for (const lang of LANGS) {
      const layersOf = (href: string): string[] => [
        ...parseState(new URL(href, "https://karta.test").search, lang).layers,
      ];
      expect(layersOf(citiesDoor(lang).href)).toContain("cities");
      expect(layersOf(capacityDoor(lang).href)).toContain("capacity");
      expect(layersOf(solarDoor(lang).href)).toContain("solar");
      expect(learnDoor(lang).href).toBe(PATHS[lang].learn);
      // the house: the solar layer, the view on the place and the place the reading is taken at
      const house = new URL(homeDoor(lang).href, "https://karta.test");
      expect(layersOf(homeDoor(lang).href)).toContain("solar");
      expect(askedSunPoint(house.search)).toEqual({ lat: 45.815, lng: 15.9819 });
      expect(parseState(house.search, lang).view).toEqual({ lat: 45.815, lng: 15.9819, zoom: 10 });
      expect(
        askedSunPoint(new URL(homeLink(lang, { lat: 43.5081, lng: 16.4402 }), "https://karta.test").search),
      ).toEqual({ lat: 43.5081, lng: 16.4402 });
      expect(countryJsonDoor(lang).href).toBe("/api/zemlja/hr.json");
      for (const door of [
        mapDoor(lang),
        learnDoor(lang),
        citiesDoor(lang),
        capacityDoor(lang),
        solarDoor(lang),
        homeDoor(lang),
      ]) {
        expect(door.title).not.toBe("");
        expect(door.text).not.toBe("");
        expect(door.icon).toContain('aria-hidden="true"');
      }
    }
  });

  it("puts the cards right under a page's lead, and in its Markdown copy as a list of links", () => {
    const site = bareSite();
    const author = authorPage(site, "hr");
    const html = renderPage(author, site);
    // the lead closes the page's head; the cards open its content
    expect(html).toMatch(
      /<div class="lead">[\s\S]*?<\/div>\s*<\/div>\s*<div class="body[^"]*">\s*<div class="content">\s*<ul class="doors">/,
    );
    expect(html).toContain(">Otvori kartu</a>");
    expect(html).toContain(`<a href="${PATHS.hr.learn}">Edukacija</a>`);
    // the support box keeps the tag and the contact as paragraphs, so the Markdown copy still has them
    expect(html).toContain('<div class="support"><img src="/keks-pay.png"');
    const markdown = pageMarkdown(author, site);
    expect(markdown).toContain("[Otvori kartu](");
    expect(markdown).toContain("#markol363");

    expect(renderPage(apiPage(site, "en"), site)).toContain(
      '<a href="/api/zemlja/hr.json">Try it: Croatia as JSON</a>',
    );
  });
});
