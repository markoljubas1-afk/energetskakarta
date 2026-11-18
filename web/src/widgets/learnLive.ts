/**
 * "Right now" on the learning page (zahtjev vlasnika 2026-11-17): the hour's renewable share, its day-ahead
 * price and what the megawatts mean, on a static page. The only script the static pages have. It is built
 * from the same modules as the map (data/greenShare.ts, data/live.ts, data/households.ts), so the figures
 * here and in the map's green card are the same computation and cannot drift apart.
 *
 * The page carries the words (seo/learnPages.ts renders the box hidden, with empty slots); this script only
 * fills in numbers and shows the box. Without script, or when the data cannot be read, the box stays hidden
 * and the page is exactly the text it was.
 */
import { ageHours, band, latestGreen, STALE_AFTER_HOURS } from "../data/greenShare";
import { compare, loadHouseholds } from "../data/households";
import { loadLive, pricesAt } from "../data/live";

/** From this multiple on, "so many times" reads better than a percentage (as in the map's green card). */
const TIMES_FROM = 1.05;

export interface NowFigures {
  /** the hour the figures are for, as the live data writes it */
  hour: string;
  /** renewable share of the country's generation in that hour, 0 to 1 */
  share: number;
  band: "low" | "mid" | "high";
  /** too old to be called "now" */
  stale: boolean;
  /** EUR/MWh, or null where the country has no market or no price for the hour */
  price: number | null;
  renewableMw: number;
  /** the technology that generated the most in that hour, and its share of the generation (0 to 1) */
  top: { technology: string; share: number };
  /** against what all households draw on average; null without Eurostat's figure */
  households: { ratio: number; averageMw: number; year: number } | null;
}

type LiveDoc = Parameters<typeof latestGreen>[0];
type HouseholdsDoc = Parameters<typeof compare>[0];

/** The figures of the box, from the two documents; null when the country reported no hour. */
export function nowFigures(
  live: LiveDoc,
  households: HouseholdsDoc | null,
  country: string,
  now: Date,
): NowFigures | null {
  const green = latestGreen(live, country, now);
  if (!green) return null;
  const found = households && green.renewableMw > 0 ? compare(households, country, green.renewableMw) : null;
  return {
    hour: green.hour,
    share: green.share,
    band: band(green.share),
    stale: ageHours(green, now) > STALE_AFTER_HOURS,
    price: pricesAt(live, green.index).find((row) => row.country === country)?.eur ?? null,
    renewableMw: green.renewableMw,
    top: { technology: green.top.technology, share: green.top.mw / green.totalMw },
    households: found ? { ratio: found.ratio, averageMw: found.power.mw, year: found.power.year } : null,
  };
}

/** Writes the figures into the box's slots (`data-v`) and shows the parts that have something to say. */
export function fill(box: HTMLElement, figures: NowFigures, lang: string): void {
  const number = (value: number, digits = 0): string =>
    new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(value);
  const set = (scope: Element, name: string, text: string): void => {
    for (const slot of scope.querySelectorAll(`[data-v="${name}"]`)) slot.textContent = text;
  };
  const part = (name: string): HTMLElement | null => box.querySelector<HTMLElement>(`[data-part="${name}"]`);
  const hour = new Date(figures.hour);
  set(
    box,
    "hour",
    new Intl.DateTimeFormat(lang, {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(hour),
  );
  set(box, "share", number(figures.share * 100));
  // a traffic light must not show the afternoon at night: an old figure keeps its number and loses its colour
  box.dataset.band = figures.stale ? "stale" : figures.band;
  const top = part("top");
  if (top) {
    // the page carries the names; a source it has no name for leaves the sentence hidden
    let names: Record<string, unknown> = {};
    try {
      names = JSON.parse(top.dataset.sources ?? "{}") as Record<string, unknown>;
    } catch (error) {
      console.error("[learn] the names of the sources could not be read", error);
    }
    const name = names[figures.top.technology];
    if (typeof name === "string" && Number.isFinite(figures.top.share)) {
      set(top, "source", name);
      set(top, "topShare", number(figures.top.share * 100));
      top.hidden = false;
    }
  }
  const price = part("price");
  if (price && figures.price !== null) {
    set(price, "price", number(figures.price, 2));
    price.hidden = false;
    price.dataset.free = figures.price <= 0 ? "true" : "false";
  }
  const stale = part("stale");
  if (stale) stale.hidden = !figures.stale;
  if (figures.households) {
    const times = figures.households.ratio >= TIMES_FROM;
    const sentence = part(times ? "times" : "share");
    if (sentence) {
      set(sentence, "mw", number(figures.renewableMw));
      set(sentence, "times", number(figures.households.ratio, 1));
      set(sentence, "percent", number(figures.households.ratio * 100));
      set(sentence, "average", number(figures.households.averageMw));
      set(sentence, "year", String(figures.households.year));
      sentence.hidden = false;
    }
  }
  box.hidden = false;
}

/** Finds the box on the page, reads the data and fills it; a failure leaves the page as it was. */
export async function start(doc: Document = document, now: Date = new Date()): Promise<void> {
  const box = doc.querySelector<HTMLElement>("[data-live-now]");
  if (!box) return;
  const { base, country = "HR", lang = "hr" } = box.dataset;
  if (!base) return;
  const baseUrl = new URL(base, window.location.href);
  const signal = new AbortController().signal;
  const [live, households] = await Promise.all([
    loadLive(baseUrl, signal),
    // the comparison is an extra: without it the share and the price still stand
    loadHouseholds(baseUrl, signal).catch((error: unknown) => {
      console.error("[learn] household consumption did not load", error);
      return null;
    }),
  ]);
  if (live.kind !== "ready") return;
  const figures = nowFigures(live.live, households, country, now);
  if (figures) fill(box, figures, lang);
}

if (typeof document !== "undefined" && document.querySelector("[data-live-now]")) {
  start().catch((error: unknown) => {
    console.error("[learn] the live figures did not load", error);
  });
}
