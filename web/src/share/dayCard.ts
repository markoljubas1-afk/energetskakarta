/**
 * "The day in three figures": a picture for sharing, drawn in the browser (no server, no third party).
 *
 * The three figures are ones the map already shows, each with its own time written under it, because they
 * are not of the same moment: the renewable share is of the latest reported hour, the price is the average
 * of that calendar day's day-ahead hours, the storage fill is of the last reported gas day. A figure the
 * data does not have is left out, never filled in; a country whose generation figures are old gets no card.
 */
import { ageHours, latestGreen, STALE_AFTER_HOURS } from "../data/greenShare";
import { readings, type GasStorage } from "../data/gasStorage";
import { COUNTRY_PRICE_ZONE, dayRange, type Live } from "../data/live";
import { isOneOf, SCOPE_COUNTRIES } from "../domain";

export interface DayCard {
  country: string;
  /** the hour the renewable share is for, as the live data writes it */
  hour: string;
  /** renewable share of the country's own generation in that hour, 0 to 1 */
  share: number;
  /** the average day-ahead price over every hour of that calendar day; null unless every hour has one */
  price: { average: number; hours: number } | null;
  /** how full the country's gas storage is, percent; null when it has none or none reported */
  storage: { full: number; day: string; facilities: number; name: string } | null;
}

function priceOf(live: Live, country: string, index: number): DayCard["price"] {
  if (!isOneOf(SCOPE_COUNTRIES, country)) return null;
  const series = live.prices[COUNTRY_PRICE_ZONE[country]];
  if (!series) return null;
  const [first, last] = dayRange(live, index);
  let sum = 0;
  for (let at = first; at <= last; at += 1) {
    const price = series.eurPerMwh[at];
    // a day with a missing hour has no average: an average of the hours that happen to be there misleads
    if (price === null || price === undefined) return null;
    sum += price;
  }
  const hours = last - first + 1;
  return { average: sum / hours, hours };
}

function storageOf(storage: GasStorage | null, country: string): DayCard["storage"] {
  if (!storage) return null;
  const rows = readings(storage).filter((row) => row.facility.country === country);
  const [only] = rows;
  if (!only) return null;
  const day = rows.reduce((latest, row) => (row.day > latest ? row.day : latest), only.day);
  if (rows.length === 1) return { full: only.full, day, facilities: 1, name: only.facility.name };
  let stored = 0;
  let capacity = 0;
  for (const row of rows) {
    const holds = row.facility.workingGasTwh;
    // a country total needs every facility's volumes; without them there is no honest total
    if (row.inStorageTwh === null || holds === null || holds <= 0) return null;
    stored += row.inStorageTwh;
    capacity += holds;
  }
  return { full: (stored / capacity) * 100, day, facilities: rows.length, name: "" };
}

/** The card for a country; null when it has no fresh generation figures. */
export function dayCard(live: Live, storage: GasStorage | null, country: string, now: Date): DayCard | null {
  const green = latestGreen(live, country, now);
  if (!green || ageHours(green, now) > STALE_AFTER_HOURS) return null;
  return {
    country,
    hour: green.hour,
    share: green.share,
    price: priceOf(live, country, green.index),
    storage: storageOf(storage, country),
  };
}

export interface CardFigure {
  value: string;
  unit: string;
  label: string;
  note: string;
}

export interface CardText {
  title: string;
  subtitle: string;
  figures: CardFigure[];
  footer: string;
}

/**
 * Two shapes of the same card: "wide" at the size link previews and posts are shown at, "story" upright
 * for a phone's full screen (stories), with the figures one under another.
 */
export const CARD_FORMATS = ["wide", "story"] as const;
export type CardFormat = (typeof CARD_FORMATS)[number];
export const CARD_SIZES: Record<CardFormat, { width: number; height: number }> = {
  wide: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
};

const MARGIN = 64;
const COLOURS = {
  top: "#0e1820",
  bottom: "#14323e",
  ink: "#f2f5f7",
  muted: "#a9b7c2",
  accent: "#5cc8d7",
  warm: "#f0b45a",
} as const;

/** Break a text into lines no wider than `width`, at spaces. */
export function wrap(measure: (text: string) => number, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const longer = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measure(longer) > width) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

const VALUE_PX = 108;
const UNIT_PX = 40;
const GAP_PX = 12;
/** the room left between a figure and the next column */
const COLUMN_GUTTER = 56;

/**
 * The font sizes of a figure and its unit, scaled down together when they would not fit `width`.
 * `measure` gives a text's width at a font size (bold; the unit is a little narrower, which errs on the
 * safe side).
 */
export function figureFonts(
  measure: (text: string, size: number) => number,
  figure: Pick<CardFigure, "value" | "unit">,
  width: number,
  full: { value: number; unit: number; gap: number } = { value: VALUE_PX, unit: UNIT_PX, gap: GAP_PX },
): { value: number; unit: number; gap: number } {
  const needed = measure(figure.value, full.value) + full.gap + measure(figure.unit, full.unit);
  const scale = Math.min(1, width / needed);
  return {
    value: Math.floor(full.value * scale),
    unit: Math.floor(full.unit * scale),
    gap: Math.round(full.gap * scale),
  };
}

/**
 * The upright card's measures. Three figures have to share the height two would have to themselves, so they
 * are set tighter; the footer keeps its place either way.
 */
const STORY = {
  roomy: { top: 330, title: 68, value: 210, unit: 76, afterValue: 70, label: 46, note: 36, between: 64 },
  tight: { top: 250, title: 60, value: 150, unit: 56, afterValue: 54, label: 42, note: 32, between: 40 },
} as const;
/** where the last line of the footer sits, above the phone's own bar */
const STORY_FOOTER_FROM_BOTTOM = 210;

/** The measures for a card of this many figures. */
function storyLayout(figures: number): (typeof STORY)[keyof typeof STORY] {
  return figures > 2 ? STORY.tight : STORY.roomy;
}

/** Upright, for a story: the figures one under another, clear of the phone's own bars at top and bottom. */
function drawStory(ctx: CanvasRenderingContext2D, text: CardText, font: string): void {
  const { width, height } = CARD_SIZES.story;
  const margin = 96;
  const room = width - 2 * margin;
  const measure = (each: string): number => ctx.measureText(each).width;
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, COLOURS.top);
  background.addColorStop(1, COLOURS.bottom);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const bar = ctx.createLinearGradient(0, 0, width, 0);
  bar.addColorStop(0, COLOURS.warm);
  bar.addColorStop(1, COLOURS.accent);
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, width, 16);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const m = storyLayout(text.figures.length);
  let y: number = m.top;
  ctx.fillStyle = COLOURS.ink;
  ctx.font = `700 ${String(m.title)}px ${font}`;
  for (const line of wrap(measure, text.title, room)) {
    ctx.fillText(line, margin, y);
    y += Math.round(m.title * 1.2);
  }
  ctx.fillStyle = COLOURS.muted;
  ctx.font = `400 ${String(Math.round(m.title * 0.65))}px ${font}`;
  ctx.fillText(text.subtitle, margin, y + 10);
  y += 10 + m.between * 2;

  for (const figure of text.figures) {
    const sizes = figureFonts(
      (each, size) => {
        ctx.font = `700 ${String(size)}px ${font}`;
        return ctx.measureText(each).width;
      },
      figure,
      room,
      { value: m.value, unit: m.unit, gap: 20 },
    );
    y += sizes.value;
    ctx.fillStyle = COLOURS.accent;
    ctx.font = `700 ${String(sizes.value)}px ${font}`;
    ctx.fillText(figure.value, margin, y);
    const after = margin + ctx.measureText(figure.value).width + sizes.gap;
    ctx.font = `600 ${String(sizes.unit)}px ${font}`;
    ctx.fillText(figure.unit, after, y);
    y += m.afterValue;
    ctx.fillStyle = COLOURS.ink;
    ctx.font = `500 ${String(m.label)}px ${font}`;
    for (const line of wrap(measure, figure.label, room)) {
      ctx.fillText(line, margin, y);
      y += Math.round(m.label * 1.25);
    }
    ctx.fillStyle = COLOURS.muted;
    ctx.font = `400 ${String(m.note)}px ${font}`;
    for (const line of wrap(measure, figure.note, room)) {
      ctx.fillText(line, margin, y);
      y += Math.round(m.note * 1.28);
    }
    y += m.between;
  }

  ctx.fillStyle = COLOURS.muted;
  ctx.font = `400 34px ${font}`;
  const footer = wrap(measure, text.footer, room);
  footer.forEach((line, at) => {
    ctx.fillText(line, margin, height - STORY_FOOTER_FROM_BOTTOM - (footer.length - 1 - at) * 44);
  });
}

/** Draw the card on a canvas of the format's size (CARD_SIZES). */
export function drawDayCard(
  ctx: CanvasRenderingContext2D,
  text: CardText,
  font: string,
  format: CardFormat = "wide",
): void {
  if (format === "story") {
    drawStory(ctx, text, font);
    return;
  }
  const { width, height } = CARD_SIZES.wide;
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, COLOURS.top);
  background.addColorStop(1, COLOURS.bottom);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const bar = ctx.createLinearGradient(0, 0, width, 0);
  bar.addColorStop(0, COLOURS.warm);
  bar.addColorStop(1, COLOURS.accent);
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, width, 10);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = COLOURS.ink;
  ctx.font = `700 46px ${font}`;
  ctx.fillText(text.title, MARGIN, 104);
  ctx.fillStyle = COLOURS.muted;
  ctx.font = `400 30px ${font}`;
  ctx.fillText(text.subtitle, MARGIN, 152);

  const column = (width - 2 * MARGIN) / Math.max(text.figures.length, 1);
  text.figures.forEach((figure, at) => {
    const x = MARGIN + at * column;
    // the figure and its unit stay inside their column: with three figures a long one is drawn smaller
    const { value, unit, gap } = figureFonts(
      (text, size) => {
        ctx.font = `700 ${String(size)}px ${font}`;
        return ctx.measureText(text).width;
      },
      figure,
      column - COLUMN_GUTTER,
    );
    ctx.fillStyle = COLOURS.accent;
    ctx.font = `700 ${String(value)}px ${font}`;
    ctx.fillText(figure.value, x, 318);
    const after = x + ctx.measureText(figure.value).width + gap;
    ctx.font = `600 ${String(unit)}px ${font}`;
    ctx.fillText(figure.unit, after, 318);
    ctx.fillStyle = COLOURS.ink;
    ctx.font = `500 28px ${font}`;
    let y = 372;
    for (const line of wrap((each) => ctx.measureText(each).width, figure.label, column - 32)) {
      ctx.fillText(line, x, y);
      y += 36;
    }
    ctx.fillStyle = COLOURS.muted;
    ctx.font = `400 23px ${font}`;
    for (const line of wrap((each) => ctx.measureText(each).width, figure.note, column - 32)) {
      ctx.fillText(line, x, y + 2);
      y += 30;
    }
  });

  ctx.fillStyle = COLOURS.muted;
  ctx.font = `400 23px ${font}`;
  ctx.fillText(text.footer, MARGIN, height - 44);
}
