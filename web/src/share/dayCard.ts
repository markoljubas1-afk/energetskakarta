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

/** The size link previews are shown at. */
export const CARD_SIZE = { width: 1200, height: 630 } as const;

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

/** Draw the card on a canvas of CARD_SIZE. */
export function drawDayCard(ctx: CanvasRenderingContext2D, text: CardText, font: string): void {
  const { width, height } = CARD_SIZE;
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
    ctx.fillStyle = COLOURS.accent;
    ctx.font = `700 108px ${font}`;
    ctx.fillText(figure.value, x, 318);
    const after = x + ctx.measureText(figure.value).width + 12;
    ctx.font = `600 40px ${font}`;
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
