import { describe, expect, it } from "vitest";

import { SAMPLE_GEOTHERMAL } from "../data/geothermal.fixture";
import { pageCitation } from "./citation";
import { renderPage } from "./html";
import { pageMarkdown } from "./markdown";
import { bareSite } from "./site.fixture";
import { buildPages, type SiteData } from "./pages";

const site: SiteData = bareSite({
  current: { createdAt: "2026-11-14T06:00:00+00:00" },
  geothermal: SAMPLE_GEOTHERMAL,
});

describe("how to cite a static page", () => {
  const page = buildPages(site).find((p) => p.path === "/geotermalna-energija/");
  if (!page) throw new Error("no page");

  it("gives APA and a line for publication, dated by the page's data", () => {
    // the geothermal page is dated by its own document (15 November), not by the map's release (Faza 31)
    const cite = pageCitation(page, site);
    expect(cite.apa).toBe(
      "GridAtlas. (2026, 15. studenoga). Geotermalna energija u Hrvatskoj [Skup podataka]. https://karta.example/geotermalna-energija/",
    );
    expect(cite.text).toBe("Izvor: GridAtlas (karta.example); stanje 15. studenoga 2026.");
  });

  it("shows it at the end of every page and in its Markdown twin", () => {
    const html = renderPage(page, site);
    expect(html).toContain('<section class="cite"><h2>Kako citirati</h2>');
    expect(html.indexOf('class="cite"')).toBeLessThan(html.indexOf("</main>"));
    expect(pageMarkdown(page, site)).toContain(
      "- Kako citirati (APA): GridAtlas. (2026, 15. studenoga). Geotermalna energija u Hrvatskoj",
    );
    const en = buildPages(site).find((p) => p.path === "/en/geothermal-energy/");
    expect(en && renderPage(en, site)).toContain("<h2>How to cite</h2>");
  });
});
