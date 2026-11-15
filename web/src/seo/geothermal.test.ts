import { describe, expect, it } from "vitest";

import type { GeoSite } from "../data/geothermal";
import { SAMPLE_GEOTHERMAL } from "../data/geothermal.fixture";
import { SAMPLE_TIMELINE } from "../data/timeline.fixture";
import { geothermalPages, hasGeothermal } from "./geothermal";
import { homeBody } from "./home";
import { pageMarkdown } from "./markdown";
import { bareSite } from "./site.fixture";
import { buildPages, PATHS, type SiteData, type StaticPage } from "./pages";
import { llmsTxt } from "./sitemap";

const site: SiteData = bareSite({ timeline: SAMPLE_TIMELINE, geothermal: SAMPLE_GEOTHERMAL });

const page = (lang: "hr" | "en"): StaticPage => {
  const found = geothermalPages(site).find((p) => p.lang === lang);
  if (!found) throw new Error("no page");
  return found;
};
/** Intl writes non-breaking spaces in numbers (L-052); compare with plain spaces. */
const plain = (value: string): string => value.replace(/[  ]/g, " ");
const text = (p: StaticPage): string =>
  plain([p.lead, ...p.sections.map((s) => s.heading + s.html)].join(" "));

describe("geothermal page", () => {
  it("exists in both languages, each pointing at the other", () => {
    expect(page("hr").path).toBe("/geotermalna-energija/");
    expect(page("hr").alternatePath).toBe("/en/geothermal-energy/");
    expect(page("en").path).toBe(PATHS.en.geothermal);
  });

  it("leads with what runs today and what is coming, to one decimal", () => {
    expect(plain(page("hr").lead)).toContain(
      "<p>U pogonu: 16,5 MW geotermalne struje i 1 lokacija koja koristi geotermalnu toplinu.</p><p>U pripremi su elektrane od ukupno 98 MW.</p><p>Potencijal za grijanje potvrđen je u 1 gradu.</p>",
    );
    expect(plain(page("en").lead)).toContain(
      "In operation: 16.5 MW of geothermal electricity and 1 site using geothermal heat.",
    );
  });

  it("agrees the Croatian nouns with their numbers and leaves out empty sentences", () => {
    const twice = (s: GeoSite): boolean =>
      (s.kind === "heat" && s.status === "operating") || s.status === "potential_confirmed";
    const more: SiteData = {
      ...site,
      geothermal: {
        ...SAMPLE_GEOTHERMAL,
        sites: SAMPLE_GEOTHERMAL.sites
          .filter((s) => s.status !== "project")
          .flatMap((s) => (twice(s) ? [s, { ...s, id: `${s.id}-2` }] : [s])),
      },
    };
    const hr = geothermalPages(more).find((p) => p.lang === "hr");
    expect(hr && plain(hr.lead)).toBe(
      "<p>U pogonu: 16,5 MW geotermalne struje i 2 lokacije koje koriste geotermalnu toplinu.</p><p>Potencijal za grijanje potvrđen je u 2 grada.</p>",
    );
  });

  it("lists sites by phase with their own sources, then the potential, the cascade and the sources", () => {
    const hr = page("hr");
    expect(hr.sections.map((s) => s.heading)).toEqual([
      "U pogonu",
      "Projekti",
      "Potvrđen potencijal za grijanje",
      "Lokalni projekti",
      "Potencijal: toplinski tok",
      "Kako se toplina koristi: kaskada",
      "Izvori",
    ]);
    const all = text(hr);
    expect(all).toContain('<strong>Velika 1</strong> (Velika Ciglena, 16,5 MW) (<a href="https://a"');
    expect(all).toContain("<strong>Topusko</strong> (Topusko, ≈ 65 °C)");
    expect(all).toContain("iz 40 mjerenja u regiji, samo unutar 75 km od mjerenja");
    expect(all).toContain("grijanje grada (toplinarstvo) (70–90 °C)");
    expect(all).toContain("GHFDB</a> (CC-BY-4.0)");
    expect(all).toContain(`href="/?l=lines,substations,plants,geothermal"`);
    const dataset = page("en").jsonLd[0] as { "@type": string; isBasedOn: string[] };
    expect(dataset["@type"]).toBe("Dataset");
    expect(dataset.isBasedOn).toContain("https://doi.org/x");
  });

  it("is linked from the home page, the transition page and llms.txt, and converts cleanly to Markdown", () => {
    expect(homeBody(site, "hr")).toContain(`href="/geotermalna-energija/"`);
    const transition = buildPages(site).find((p) => p.path === PATHS.hr.transition);
    expect(transition && text(transition)).toContain(`href="/geotermalna-energija/"`);
    expect(llmsTxt(site)).toContain("/en/geothermal-energy/");
    const md = pageMarkdown(page("hr"), site);
    expect(md).not.toMatch(/<[a-z][^>]*>/);
    expect(md).toContain("# Geotermalna energija u Hrvatskoj");
  });

  it("has no page and no links without the geothermal document", () => {
    const bare: SiteData = { ...site, geothermal: null };
    expect(hasGeothermal(bare)).toBe(false);
    expect(geothermalPages(bare)).toEqual([]);
    expect(homeBody(bare, "hr")).not.toContain("/geotermalna-energija/");
    expect(llmsTxt(bare)).not.toContain("geothermal-energy");
  });
});
