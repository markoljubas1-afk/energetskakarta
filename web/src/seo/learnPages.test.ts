import { describe, expect, it } from "vitest";

import { LANGS } from "../state/url";
import { parseState } from "../state/url";
import { LEARN_COPY, learnPage } from "./learnPages";
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

  it("links only to views the map understands", () => {
    for (const lang of LANGS) {
      const page = learnPage(bareSite(), lang);
      const links = [
        ...page.sections
          .map((section) => section.html)
          .join("")
          .matchAll(/href="([^"]+)"/g),
      ].map((match) => match[1] ?? "");
      expect(links).toHaveLength(LEARN_COPY[lang].tries.length);
      for (const [index, link] of links.entries()) {
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
});
