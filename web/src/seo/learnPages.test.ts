import { describe, expect, it } from "vitest";

import { LANGS } from "../state/url";
import { parseState } from "../state/url";
import { STORIES, STORY_KEYS } from "../stories/stories";
import { LEARN_COPY, learnPage } from "./learnPages";
import { e } from "./markup";
import { buildPages } from "./pages";
import { PATHS } from "./site";
import { bareSite } from "./site.fixture";

describe("the learning corner", () => {
  it("is a page in both languages, each pointing at the other", () => {
    const pages = buildPages(bareSite());
    const hr = pages.find((page) => page.path === "/edukacija/");
    const en = pages.find((page) => page.path === "/en/learn/");
    expect(hr?.alternatePath).toBe("/en/learn/");
    expect(en?.alternatePath).toBe("/edukacija/");
    expect(PATHS.hr.learn).toBe("/edukacija/");
  });

  it("explains the same terms, in the same order, in both languages", () => {
    expect(LEARN_COPY.en.terms).toHaveLength(LEARN_COPY.hr.terms.length);
    expect(LEARN_COPY.en.journey).toHaveLength(LEARN_COPY.hr.journey.length);
    expect(LEARN_COPY.en.tries.map(([, , params]) => params)).toEqual(
      LEARN_COPY.hr.tries.map(([, , params]) => params),
    );
  });

  it("answers its questions on the page and marks the same ones up as an FAQ", () => {
    for (const lang of LANGS) {
      const page = learnPage(bareSite(), lang);
      const copy = LEARN_COPY[lang];
      const section = page.sections.find((each) => each.heading === copy.faqHeading);
      const faq = page.jsonLd.find((doc) => doc["@type"] === "FAQPage") as
        { mainEntity: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
      expect(faq?.mainEntity).toHaveLength(copy.faq.length);
      for (const entry of faq?.mainEntity ?? []) {
        // every marked-up question and answer is on the page itself
        expect(section?.html).toContain(`<summary>${e(entry.name)}</summary>`);
        expect(section?.html).toContain(`<p>${e(entry.acceptedAnswer.text)}</p>`);
      }
    }
    expect(LEARN_COPY.en.faq).toHaveLength(LEARN_COPY.hr.faq.length);
  });

  it("links only to views the map understands", () => {
    for (const lang of LANGS) {
      const page = learnPage(bareSite(), lang);
      const links = [
        ...page.sections
          .map((section) => section.html)
          .join("")
          .matchAll(/href="([^"]+)"/g),
      ].map((match) => match[1] ?? "");
      const stories = links.filter((link) => link.includes("story="));
      // the fixture release has no routes, so the story that needs one is not offered
      const playable = STORY_KEYS.filter((key) => STORIES[key].route === undefined);
      expect(playable).not.toContain("kilovatsat");
      expect(
        stories.map((link) => parseState(new URL(link, "https://karta.test").search, lang).story),
      ).toEqual(playable);
      // the solar section's own links open the solar layer: the calculator, and the house on a place
      const solar = links.filter((link) => link.includes("solar"));
      expect(
        solar.map((link) => [...parseState(new URL(link, "https://karta.test").search, lang).layers]),
      ).toEqual([
        ["lines", "solar"],
        ["lines", "solar"],
      ]);
      expect(solar.map((link) => link.includes("sun="))).toEqual([false, true]);
      // the section on negative prices opens the hourly prices; it comes before the "try it" list
      // links out of the site (the roof calculator) are not views of the map
      const external = links.filter((link) => link.startsWith("https://"));
      expect(external).toEqual([]);
      const [price, ...views] = links.filter(
        (link) => !link.includes("story=") && !link.includes("solar") && !link.startsWith("https://"),
      );
      expect(parseState(new URL(price ?? "", "https://karta.test").search, lang).live).toBe(true);
      expect(views).toHaveLength(LEARN_COPY[lang].tries.length);
      for (const [index, link] of views.entries()) {
        const asked = LEARN_COPY[lang].tries[index]?.[2] ?? {};
        const state = parseState(new URL(link.replaceAll("&amp;", "&"), "https://karta.test").search, lang);
        // every layer the link names is one the map has, and it ends up switched on
        for (const layer of (asked.l ?? "").split(",").filter(Boolean)) {
          expect([...state.layers], link).toContain(layer);
        }
        expect(state.live, link).toBe(asked.live === "1");
      }
    }
  });

  it("carries its glossary as structured data", () => {
    const [terms] = learnPage(bareSite(), "hr").jsonLd;
    expect(terms?.["@type"]).toBe("DefinedTermSet");
    expect(terms?.hasDefinedTerm).toHaveLength(LEARN_COPY.hr.terms.length);
  });

  it("offers the story with the travelling light once the release has routes", () => {
    const site = bareSite();
    const withRoutes = { ...site, current: { ...site.current, routes: "builds/x/routes.json" } };
    const html = learnPage(withRoutes, "hr")
      .sections.map((section) => section.html)
      .join("");
    expect(html).toContain('href="/?story=kilovatsat"');
    expect(html).toContain("Put jednog kilovatsata");
  });

  it("offers the time machine, some decades back, once the release has a timeline", () => {
    const site = bareSite();
    const html = (current: typeof site.current) =>
      learnPage({ ...site, current }, "hr")
        .sections.map((section) => section.html)
        .join("");
    expect(html(site.current)).not.toContain("Vremeplov");
    const withTimeline = html({ ...site.current, timeline: "builds/x/timeline.json" });
    expect(withTimeline).toContain(">Vremeplov</a>");
    const link = /href="([^"]+)">Vremeplov/.exec(withTimeline)?.[1] ?? "";
    const state = parseState(new URL(link.replaceAll("&amp;", "&"), "https://karta.test").search, "hr");
    expect(state.year).toBe(1960);
    expect([...state.layers]).toContain("plants");
  });

  it("folds its glossary term by term, starts stories from cards, and sends a roof to the calculator", () => {
    const html = learnPage(bareSite(), "hr")
      .sections.map((section) => section.html)
      .join("");
    expect(html.match(/<details><summary>/g)).toHaveLength(
      LEARN_COPY.hr.terms.length + LEARN_COPY.hr.faq.length,
    );
    expect(html).toContain("<summary>Instalirana snaga</summary>");
    expect(html).not.toContain("<dl>");
    // a story card: an icon, the title as the link, what it is about, and what the card does
    expect(html).toMatch(
      /<li><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg><a href="\/\?story=put-struje">[^<]+<\/a> <span>[^<]+<\/span> <em>Pokreni priču<\/em><\/li>/,
    );
    expect(html).toContain('class="callout"');
    expect(html).toContain('<a href="/?l=lines%2Csolar">Izračunaj na karti</a>');
    // and to the house with panels, opened on an example place
    expect(html).toMatch(
      /<a href="\/\?l=lines%2Csolar&amp;v=[^"]+&amp;sun=[^"]+">Kuća s panelima: kamo ide struja<\/a>/,
    );
  });
});
