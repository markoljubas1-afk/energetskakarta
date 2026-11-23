import { describe, expect, it } from "vitest";

import { completeDataset, renderPage } from "./html";
import { staticFiles } from "./prerender";
import type { StaticPage } from "./site";
import { bareSite } from "./site.fixture";

/** Faza 51: what every page's head says about itself. */

const site = bareSite();
const page: StaticPage = {
  path: "/izvjestaji/2026-10/",
  lang: "hr",
  alternatePath: "/en/reports/2026-10/",
  title: "Naslov",
  description: "Opis.",
  heading: "Naslov",
  lead: "<p>Uvod.</p>",
  sections: [],
  jsonLd: [{ "@context": "https://schema.org", "@type": "Dataset", name: "Izvještaj" }],
  lastModified: "2026-11-20T06:14:26+00:00",
  breadcrumbs: [],
  apiPath: "/api/izvjestaj.json",
};

describe("a data set on a page", () => {
  it("says when its data is from, who put it together and where it can be taken as data", () => {
    expect(completeDataset({ "@type": "Dataset" }, page, site)).toEqual({
      "@type": "Dataset",
      dateModified: "2026-11-20T06:14:26+00:00",
      creator: { "@type": "Organization", name: "GridAtlas", url: "https://karta.example/" },
      distribution: [
        {
          "@type": "DataDownload",
          encodingFormat: "text/markdown",
          contentUrl: "https://karta.example/izvjestaji/2026-10/index.md",
        },
        {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: "https://karta.example/api/izvjestaj.json",
        },
      ],
    });
  });

  it("keeps what the page said more exactly, and claims no licence of its own", () => {
    const own = { "@type": "Dataset", creator: "ENTSO-E", distribution: [], dateModified: "2026-01-01" };
    const done = completeDataset(own, page, site);
    expect(done).toEqual(own);
    expect(completeDataset({ "@type": "Dataset" }, page, site)).not.toHaveProperty("license");
  });
});

describe("the head of every page", () => {
  it("names the icons, the manifest and the size of the share picture", () => {
    const html = renderPage(page, site);
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest">');
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
  });

  it("dates a text by the day its content changed, not by the data build", () => {
    const article = {
      ...page,
      jsonLd: [{ "@context": "https://schema.org", "@type": "Article", dateModified: "2026-11-23T13:46:49" }],
      contentModified: "2026-11-19",
    };
    expect(renderPage(article, site)).toContain('"dateModified":"2026-11-19"');
    // the build passes the manifest's day in (here every page is new, so the day of this build)
    const files = staticFiles(site);
    const manifest = JSON.parse(files.get("seo-manifest.json") ?? "{}") as {
      pages: Record<string, { lastmod: string }>;
    };
    const day = manifest.pages["/edukacija/"]?.lastmod;
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const html = files.get("edukacija/index.html") ?? "";
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain(`"dateModified":"${String(day)}"`);
  });
});
