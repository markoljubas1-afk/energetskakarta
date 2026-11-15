import { describe, expect, it } from "vitest";

import { SUPPORT_CONTENT, supportEnabled, SupportContentSchema, type SupportContent } from "../support";
import { renderPage } from "./html";
import { llmsTxt } from "./sitemap";
import { bareSite } from "./site.fixture";
import { buildPages, PATHS, type SiteData, type StaticPage } from "./pages";
import { supportPages } from "./support";

const off: SiteData = bareSite();
const on: SiteData = { ...off, support: SUPPORT_CONTENT };
const text = (page: StaticPage): string =>
  [page.lead, ...page.sections.map((s) => s.heading + s.html)].join(" ");
const about = (site: SiteData) => {
  const page = buildPages(site).find((p) => p.path === PATHS.hr.about);
  if (!page) throw new Error("no about page");
  return page;
};

describe("the support page switch", () => {
  it("reads 1 or true as on, anything else as off", () => {
    expect([
      supportEnabled("1"),
      supportEnabled(" TRUE "),
      supportEnabled("0"),
      supportEnabled(""),
      supportEnabled(undefined),
    ]).toEqual([true, true, false, false, false]);
  });

  it("ships content that passes its own checks", () => {
    expect(SupportContentSchema.parse(SUPPORT_CONTENT)).toEqual(SUPPORT_CONTENT);
  });
});

describe("the support page", () => {
  it("does not exist while switched off, and nothing links to it", () => {
    expect(supportPages(off)).toEqual([]);
    expect(buildPages(off).some((p) => p.path === PATHS.hr.support)).toBe(false);
    expect(renderPage(about(off), off)).not.toContain(PATHS.hr.support);
    expect(llmsTxt(off)).not.toContain("support");
  });

  it("when on, explains how to help, says who supports it and that they do not shape the data", () => {
    const [hr, en] = supportPages(on);
    expect(hr?.path).toBe("/podrska/");
    expect(en?.path).toBe("/en/support/");
    expect(hr?.sections.map((s) => s.heading)).toEqual([
      "Najjednostavnije: koristite, dijelite i citirajte",
      "Podaci",
      "Partnerstva",
      "Tko podržava projekt",
      "Neovisnost",
    ]);
    expect(hr && text(hr)).toContain("Projekt trenutno nema financijera ni partnera.");
    // no donations and no contact until they exist
    expect(hr && text(hr)).not.toContain("donacij");
    expect(hr && text(hr)).not.toContain("mailto:");
  });

  it("is linked quietly from every page's footer and from the about page when on", () => {
    const html = renderPage(about(on), on);
    expect(html).toContain('<p><a href="/podrska/">Podržite projekt</a></p>\n</footer>');
    expect(about(on).sections.at(-1)?.heading).toBe("Podrška i partneri");
  });

  it("lists partners by role with the month they joined, adds donations and contact when given", () => {
    const content: SupportContent = {
      contact: "podrska@karta.example",
      donate: "https://udruga.example/doniraj",
      partners: [
        { name: "Fakultet X", url: "https://fakultet.example", role: "institution", since: "2027-02" },
        { name: "Zaklada Y", url: null, role: "funder", since: "2027-01" },
      ],
    };
    const [hr] = supportPages({ ...on, support: content });
    if (!hr) throw new Error("no page");
    const all = text(hr);
    expect(all).toContain("<h3>Financijeri</h3><ul><li>Zaklada Y (od siječnja 2027.)</li></ul>");
    expect(all).toContain('<a href="https://fakultet.example" rel="noopener">Fakultet X</a>');
    expect(all).toContain('<a href="https://udruga.example/doniraj" rel="noopener">stranica za donacije</a>');
    expect(all).toContain('<a href="mailto:podrska@karta.example">podrska@karta.example</a>');
    const json = hr.jsonLd[0] as { about: { funder?: { name: string }[] } };
    expect(json.about.funder?.map((f) => f.name)).toEqual(["Zaklada Y"]);
  });
});
