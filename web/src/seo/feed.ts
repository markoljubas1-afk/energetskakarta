/**
 * Atom feed of what changed in the latest data release, from the change report (`diff.json`). One
 * entry per data layer with changes, plus a summary entry; readers, news aggregators and AI assistants
 * see fresh, dated content every week without opening the map. Other pages can add dated entries of their
 * own (the latest monthly reports, Faza 29).
 */
import { summarizeDiff, type Diff, type LayerChanges } from "../data/diff";
import { createI18n, type I18n } from "../i18n";
import { DOWNLOAD_LABELS } from "../i18n/labels";
import type { Lang } from "../state/url";
import { COPY } from "./copy";
import { mapLink, PATHS, type SiteData } from "./site";
import { escapeHtml as e } from "./markup";
import { reportMonths } from "./report";

export const FEED_PATHS: Record<Lang, string> = { hr: "/feed.xml", en: "/en/feed.xml" };
/** The feed carries the release's changes and the monthly reports, so its name covers both. */
const FEED_TITLE: Record<Lang, string> = { hr: "Novo na karti", en: "What's new on the map" };

/** Whether the build writes a feed: a site address and something to put in it (Faza 31). */
export function hasFeed(site: SiteData): boolean {
  return Boolean(site.siteUrl && (site.diff ?? reportMonths(site).length > 0));
}

/** A dated entry another page contributes to the feed. */
export interface FeedEntry {
  id: string;
  title: string;
  link: string;
  /** HTML, escaped for the XML here */
  html: string;
  /** ISO 8601 */
  updated: string;
}

function entryHtml(layer: LayerChanges, lang: Lang, i18n: I18n, siteUrl: string): string {
  const { t } = i18n;
  const counts = [
    layer.added > 0 ? `${t("changesAdded")}: ${i18n.number(layer.added)}` : null,
    layer.changed > 0 ? `${t("changesChanged")}: ${i18n.number(layer.changed)}` : null,
    layer.removed > 0 ? `${t("changesRemoved")}: ${i18n.number(layer.removed)}` : null,
  ].filter((part): part is string => part !== null);
  const items = layer.examples.map(({ kind, example }) => {
    const name = example.name ?? t("detailsUnnamed");
    const label = t(
      kind === "added" ? "changesAdded" : kind === "changed" ? "changesChanged" : "changesRemoved",
    );
    const href =
      kind !== "removed" && example.lon !== undefined && example.lat !== undefined
        ? siteUrl +
          mapLink(lang, { sel: example.id, v: `${example.lat.toFixed(4)},${example.lon.toFixed(4)},12` })
        : null;
    return `<li>${e(label)}: ${href ? `<a href="${e(href)}">${e(name)}</a>` : e(name)}</li>`;
  });
  return `<p>${e(counts.join(" · "))} (${e(t("changesUnchanged", { count: i18n.number(layer.unchanged) }))})</p>${
    items.length > 0 ? `<ul>${items.join("")}</ul>` : ""
  }`;
}

/** Entries for the latest release's changes. */
function releaseEntries(site: SiteData, diff: Diff, lang: Lang, siteUrl: string): FeedEntry[] {
  const i18n = createI18n(lang);
  const summary = summarizeDiff(diff, 10);
  const updated = new Date(site.current.createdAt).toISOString();
  const totals = `${i18n.t("changesAdded")}: ${i18n.number(summary.totals.added)} · ${i18n.t("changesChanged")}: ${i18n.number(summary.totals.changed)} · ${i18n.t("changesRemoved")}: ${i18n.number(summary.totals.removed)}`;
  const since =
    summary.since === null
      ? i18n.t("changesFirst")
      : i18n.t("changesSince", { date: i18n.date(summary.since) });
  return [
    {
      id: `${siteUrl}/#release-${site.current.buildId}`,
      title: `${i18n.t("changesTitle")} – ${i18n.date(site.current.createdAt)}`,
      link: siteUrl + mapLink(lang, { panel: "changes" }),
      html: `<p>${e(since)}</p><p>${e(totals)}</p>`,
      updated,
    },
    ...summary.layers.map((layer) => ({
      id: `${siteUrl}/#release-${site.current.buildId}-${layer.layer}`,
      title: `${i18n.t(DOWNLOAD_LABELS[layer.layer])}: ${i18n.t("changesTitle").toLowerCase()}`,
      link: siteUrl + PATHS[lang].about,
      html: entryHtml(layer, lang, i18n, siteUrl),
      updated,
    })),
  ];
}

/**
 * The Atom document: the release's changes (when there is a change report) and the `extra` entries; null
 * without a site URL or without any entry.
 */
export function atomFeed(
  site: SiteData,
  diff: Diff | null,
  lang: Lang,
  extra: readonly FeedEntry[] = [],
): string | null {
  if (!site.siteUrl) return null;
  const siteUrl = site.siteUrl;
  const entries = [...(diff ? releaseEntries(site, diff, lang, siteUrl) : []), ...extra];
  if (entries.length === 0) return null;
  const copy = COPY[lang];
  const updated =
    entries
      .map((entry) => new Date(entry.updated).toISOString())
      .sort()
      .at(-1) ?? "";
  const feedUrl = siteUrl + FEED_PATHS[lang];
  const homeUrl = siteUrl + mapLink(lang, {});
  const entryXml = entries
    .map(
      (entry) => `  <entry>
    <id>${e(entry.id)}</id>
    <title>${e(entry.title)}</title>
    <link href="${e(entry.link)}"/>
    <updated>${new Date(entry.updated).toISOString()}</updated>
    <content type="html">${e(entry.html)}</content>
  </entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">
  <id>${e(feedUrl)}</id>
  <title>${e(copy.siteTitle)} – ${e(FEED_TITLE[lang])}</title>
  <subtitle>${e(copy.siteDescription)}</subtitle>
  <link href="${e(feedUrl)}" rel="self" type="application/atom+xml"/>
  <link href="${e(homeUrl)}"/>
  <updated>${updated}</updated>
  <author><name>Energetska karta – suradnici</name></author>
  <rights>ODbL 1.0 / CC BY 4.0 / partly CC BY-NC 4.0 (downloads non-commercial as a whole)</rights>
${entryXml}
</feed>
`;
}
