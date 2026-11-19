/**
 * How to cite a static page (Faza 23-7): its title and address, dated by its data; shown on the page and in
 * its Markdown twin, worded like the charts' citations (share/cite.ts).
 */
import { createI18n } from "../i18n";
import { citations, type Citations } from "../share/cite";
import type { SiteData, StaticPage } from "./site";

export function pageCitation(page: StaticPage, site: SiteData): Citations {
  return citations({
    lang: page.lang,
    site: createI18n(page.lang).t("appName"),
    title: page.heading,
    url: site.siteUrl ? site.siteUrl + page.path : page.path,
    sources: [],
    dataDate: page.lastModified,
    accessed: null,
    // a page that describes no data set (the learning corner) is cited as a text
    ...(page.jsonLd.some((each) => each["@type"] === "Dataset") ? {} : { kind: "text" as const }),
  });
}
