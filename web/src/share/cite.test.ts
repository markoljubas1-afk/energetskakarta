import { describe, expect, it } from "vitest";

import { citations, hostOf, type CiteInput } from "./cite";

const chart: CiteInput = {
  lang: "hr",
  site: "Regionalna energetska karta",
  title: "Proizvodnja po izvoru i potrošnja: Hrvatska, mjesečno",
  url: "https://energetska-karta.tmit.hr/?p=energy&ea=HR#mix",
  sources: ["ENTSO-E Transparency Platform"],
  dataDate: "2026-11-14T06:00:00Z",
  accessed: new Date("2026-11-15T10:00:00Z"),
};

describe("citations", () => {
  it("writes APA 7 with the date of the data and the day it was retrieved, without a full stop after the URL", () => {
    expect(citations(chart).apa).toBe(
      "Regionalna energetska karta. (2026, 14. studenoga). Proizvodnja po izvoru i potrošnja: Hrvatska, mjesečno [Skup podataka]. Preuzeto 15. studenoga 2026. s https://energetska-karta.tmit.hr/?p=energy&ea=HR#mix",
    );
    expect(
      citations({ ...chart, lang: "en", site: "Regional Energy Map", title: "Generation by source" }).apa,
    ).toBe(
      "Regional Energy Map. (2026, November 14). Generation by source [Data set]. Retrieved November 15, 2026, from https://energetska-karta.tmit.hr/?p=energy&ea=HR#mix",
    );
  });

  it("gives a newsroom one line naming the site and the original source", () => {
    expect(citations(chart).text).toBe(
      "Izvor: Regionalna energetska karta (energetska-karta.tmit.hr), prema podacima ENTSO-E Transparency Platform; stanje 14. studenoga 2026.",
    );
    expect(citations({ ...chart, lang: "en", site: "Regional Energy Map", sources: [] }).text).toBe(
      "Source: Regional Energy Map (energetska-karta.tmit.hr); as of November 14, 2026.",
    );
  });

  it("writes BibTeX with TeX's special characters escaped and the URL untouched", () => {
    const bib = citations({ ...chart, title: "Udio 50% & više_test" }).bibtex;
    expect(bib).toContain("@misc{energetskakarta2026,");
    expect(bib).toContain("  author = {{Regionalna energetska karta}},");
    expect(bib).toContain("  title = {Udio 50\\% \\& više\\_test},");
    expect(bib).toContain("  howpublished = {\\url{https://energetska-karta.tmit.hr/?p=energy&ea=HR#mix}},");
    expect(bib).toContain("pristupljeno 2026-11-15");
  });

  it("cites a page built ahead of time without a retrieval date, and without any date as b. d.", () => {
    const page = { ...chart, accessed: null, url: "https://energetska-karta.tmit.hr/zelena-tranzicija/" };
    expect(citations(page).apa).toBe(
      "Regionalna energetska karta. (2026, 14. studenoga). Proizvodnja po izvoru i potrošnja: Hrvatska, mjesečno [Skup podataka]. https://energetska-karta.tmit.hr/zelena-tranzicija/",
    );
    expect(citations({ ...page, dataDate: null }).apa).toContain("Regionalna energetska karta. (b. d.).");
  });

  it("shows a host, or the address itself when it is only a path", () => {
    expect(hostOf("https://energetska-karta.tmit.hr/x/")).toBe("energetska-karta.tmit.hr");
    expect(hostOf("/zelena-tranzicija/")).toBe("/zelena-tranzicija/");
  });
});
