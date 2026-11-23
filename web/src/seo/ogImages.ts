/**
 * The pictures a shared link to a topic page shows (Faza 47-7), drawn by scripts/og-topics.mjs into
 * public/. Every other page shows the site's own picture (home.ts, `OG_IMAGE`). None of them carries a
 * figure, so none goes out of date.
 */
import type { Lang } from "../state/url";

/** The size every share picture of the site is drawn at, written next to it in each page's head. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

export type OgTopic = "gas" | "transition" | "report";

export const OG_TOPIC_IMAGES: Record<OgTopic, Record<Lang, string>> = {
  gas: { hr: "/og-plin.png", en: "/og-gas.png" },
  transition: { hr: "/og-tranzicija.png", en: "/og-transition.png" },
  report: { hr: "/og-izvjestaj.png", en: "/og-report.png" },
};

export const ogImage = (topic: OgTopic, lang: Lang): string => OG_TOPIC_IMAGES[topic][lang];
