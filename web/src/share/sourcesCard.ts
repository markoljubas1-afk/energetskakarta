/**
 * "What the electricity was made of": a picture for sharing of one complete day or month (Faza 41).
 *
 * The figures are the daily and monthly totals of ENTSO-E the energy page shows, not the live layer's
 * hours: a day that is still running has no total. Only a period the platform reported in full is used,
 * and the picture carries its date. Consumption is the system's total load, shown only when it was
 * reported for the whole period; the sentence about imports compares those two measured totals and says
 * nothing more. The carbon figure is a calculation (data/co2.ts) and is labelled as one.
 */
import { intensity } from "../data/co2";
import { series, type Periods, type YearFile } from "../data/energy";
import { RENEWABLE } from "../data/greenShare";
import { krskoHalfOfPeriod, krskoHalfOfRange } from "../data/krsko";
import { isOneOf, TECHNOLOGIES, type Technology } from "../domain";
import { CARD_COLOURS, CARD_SIZES, figureFonts, paintCard, wrap, type CardFormat } from "./dayCard";
import { drawRing } from "./ring";

export type SourcesUnit = "day" | "month";

export interface SourcesCard {
  country: string;
  unit: SourcesUnit;
  /** "2026-11-17" or "2026-10" */
  period: string;
  /** what was generated, largest first; technologies that generated nothing are left out */
  parts: { technology: Technology; mwh: number; share: number }[];
  totalMwh: number;
  /** renewable share of the generation, 0 to 1 (pumped storage is not renewable: data/greenShare.ts) */
  renewableShare: number;
  /** total load of the system, MWh; null unless it was reported for the whole period */
  loadMwh: number | null;
  /** g CO₂-eq per kWh generated (a calculation); null when nothing countable was generated */
  co2: number | null;
  /** Croatia's half of the Krško nuclear plant in the same period, MWh (data/krsko.ts); null when unknown */
  krskoMwh: number | null;
}

/** A day counts as reported in full from here (the pipeline writes 1.0 for a complete one). */
const COMPLETE = 0.999;
/**
 * A month counts as complete from here: the same limit as the monthly reports (seo/energyPages.ts,
 * COMPLETE_COVERAGE), so that every report's month has its picture. A test holds the two together.
 */
export const MONTH_COMPLETE = 0.98;

function build(
  country: string,
  unit: SourcesUnit,
  period: string,
  byTech: ReadonlyMap<Technology, number>,
  loadMwh: number | null,
  krskoMwh: number | null,
): SourcesCard | null {
  const totalMwh = [...byTech.values()].reduce((sum, mwh) => sum + mwh, 0);
  if (!(totalMwh > 0)) return null;
  const parts = [...byTech.entries()]
    .filter(([, mwh]) => mwh > 0)
    .map(([technology, mwh]) => ({ technology, mwh, share: mwh / totalMwh }))
    .sort((a, b) => b.mwh - a.mwh);
  const renewable = parts
    .filter((part) => RENEWABLE.includes(part.technology))
    .reduce((sum, part) => sum + part.mwh, 0);
  return {
    country,
    unit,
    period,
    parts,
    totalMwh,
    renewableShare: renewable / totalMwh,
    loadMwh,
    co2: intensity(parts.map((part) => [part.technology, part.mwh] as const)),
    krskoMwh,
  };
}

/** The latest day the country's generation was reported in full, from the daily files (any order). */
export function latestDay(files: readonly YearFile[], country: string): SourcesCard | null {
  const newestFirst = [...files].sort((a, b) => b.year - a.year);
  for (const file of newestFirst) {
    const data = file.countries[country];
    if (!data) continue;
    for (let index = file.days.length - 1; index >= 0; index -= 1) {
      const day = file.days[index];
      if (day === undefined || (data.coverage.generation[index] ?? 0) < COMPLETE) continue;
      const byTech = new Map<Technology, number>();
      for (const [raw, values] of Object.entries(data.generation)) {
        const value = values[index];
        if (value === null || value === undefined) continue;
        const technology: Technology = isOneOf(TECHNOLOGIES, raw) ? raw : "other";
        byTech.set(technology, (byTech.get(technology) ?? 0) + Math.max(0, value));
      }
      const load = data.load[index];
      const loadKnown = (data.coverage.load[index] ?? 0) >= COMPLETE && load !== null && load !== undefined;
      const card = build(
        country,
        "day",
        day,
        byTech,
        loadKnown ? load : null,
        krskoHalfOfRange(files, day, day),
      );
      if (card) return card;
    }
  }
  return null;
}

/**
 * The latest month the country's generation was reported in full; with `asked` ("2026-10"), that month
 * and no other (a monthly report links to the picture of its own month).
 */
export function latestMonth(
  periods: Periods,
  country: string,
  asked: string | null = null,
): SourcesCard | null {
  if (!(country in periods.countries)) return null;
  const data = series(periods, country, "month");
  for (let index = data.periods.length - 1; index >= 0; index -= 1) {
    const month = data.periods[index];
    if (month === undefined || (data.coverage[index] ?? 0) < MONTH_COMPLETE) continue;
    if (asked !== null && month !== asked) continue;
    const byTech = new Map<Technology, number>();
    for (const technology of TECHNOLOGIES) {
      const value = data.generation[technology]?.[index];
      if (value !== null && value !== undefined) byTech.set(technology, Math.max(0, value));
    }
    const load = data.load[index];
    const loadKnown =
      (data.loadCoverage[index] ?? 0) >= MONTH_COMPLETE && load !== null && load !== undefined;
    const krsko = krskoHalfOfPeriod(periods, "month", month);
    const card = build(country, "month", month, byTech, loadKnown ? load : null, krsko);
    if (card) return card;
  }
  return null;
}

/** The month of "?pic=2026-10" in the address the page was opened with; null without one. */
export function askedPictureMonth(search: string): string | null {
  const month = new URLSearchParams(search).get("pic");
  return month !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

/** Countries that have a picture of this kind at all, in the order given. */
export function sourcesCountries(periods: Periods, order: readonly string[]): string[] {
  return order.filter((code) => code in periods.countries);
}

export interface SourcesLegendRow {
  label: string;
  /** "45 %" */
  value: string;
  share: number;
  colour: string;
}

export interface SourcesText {
  title: string;
  subtitle: string;
  /** written in the ring's hole */
  centre: { value: string; label: string };
  legend: SourcesLegendRow[];
  figures: { value: string; unit: string; label: string }[];
  /** the comparison of consumption and generation; null when the load is not known */
  sentence: string | null;
  /**
   * Croatia's half of Krško, for Croatia and Slovenia (data/krsko.ts), in full: for a screen reader, and
   * under the picture in the dialog. Too long for the picture, which draws `badge`.
   */
  note: string | null;
  /** the same in a few words, drawn under the subtitle, above the ring; null when there is no note */
  badge: string | null;
  footer: string;
}

/** The ring shows this many sources by name; the rest are one "other sources" part. */
export const LEGEND_ROWS = 5;

/** The largest sources by name and the rest folded into one row (null when there is no rest). */
export function foldParts(parts: SourcesCard["parts"]): { named: SourcesCard["parts"]; restShare: number } {
  const named = parts.slice(0, LEGEND_ROWS);
  const restShare = parts.slice(LEGEND_ROWS).reduce((sum, part) => sum + part.share, 0);
  return { named, restShare };
}

const { ink, muted, accent, top } = CARD_COLOURS;

function drawCentre(
  ctx: CanvasRenderingContext2D,
  text: SourcesText["centre"],
  font: string,
  at: { x: number; y: number },
  size: { value: number; label: number },
  /** the hole's width the two lines have to stay inside */
  room: number,
): void {
  const fit = (weight: number, px: number, words: string): void => {
    ctx.font = `${String(weight)} ${String(px)}px ${font}`;
    const needed = ctx.measureText(words).width;
    if (needed > room) ctx.font = `${String(weight)} ${String(Math.floor((px * room) / needed))}px ${font}`;
  };
  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  fit(700, size.value, text.value);
  ctx.fillText(text.value, at.x, at.y + size.value * 0.2);
  ctx.fillStyle = muted;
  fit(400, size.label, text.label);
  ctx.fillText(text.label, at.x, at.y + size.value * 0.2 + size.label * 1.5);
  ctx.textAlign = "left";
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  rows: readonly SourcesLegendRow[],
  font: string,
  box: { x: number; y: number; width: number },
  size: { text: number; row: number },
): void {
  rows.forEach((row, at) => {
    const y = box.y + at * size.row;
    ctx.fillStyle = row.colour;
    ctx.beginPath();
    ctx.arc(box.x + size.text * 0.36, y - size.text * 0.34, size.text * 0.36, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = `700 ${String(size.text)}px ${font}`;
    ctx.textAlign = "right";
    ctx.fillText(row.value, box.x + box.width, y);
    ctx.textAlign = "left";
    // a long name is written smaller rather than run into its percentage
    const room = box.width - size.text * 1.15 - ctx.measureText(row.value).width - size.text * 0.6;
    ctx.font = `400 ${String(size.text)}px ${font}`;
    const needed = ctx.measureText(row.label).width;
    if (needed > room) ctx.font = `400 ${String(Math.floor((size.text * room) / needed))}px ${font}`;
    ctx.fillText(row.label, box.x + size.text * 1.15, y);
  });
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  figure: SourcesText["figures"][number],
  font: string,
  box: { x: number; y: number; width: number },
  size: { value: number; unit: number; label: number },
): void {
  const fonts = figureFonts(
    (each, px) => {
      ctx.font = `700 ${String(px)}px ${font}`;
      return ctx.measureText(each).width;
    },
    figure,
    box.width,
    { value: size.value, unit: size.unit, gap: Math.round(size.unit * 0.4) },
  );
  ctx.fillStyle = accent;
  ctx.font = `700 ${String(fonts.value)}px ${font}`;
  ctx.fillText(figure.value, box.x, box.y);
  const after = box.x + ctx.measureText(figure.value).width + fonts.gap;
  ctx.font = `600 ${String(fonts.unit)}px ${font}`;
  ctx.fillText(figure.unit, after, box.y);
  ctx.fillStyle = muted;
  ctx.font = `400 ${String(size.label)}px ${font}`;
  let y = box.y + Math.round(size.label * 1.5);
  for (const line of wrap((each) => ctx.measureText(each).width, figure.label, box.width)) {
    ctx.fillText(line, box.x, y);
    y += Math.round(size.label * 1.25);
  }
}

/** Croatia's half of Krško in one line, in the accent colour; written smaller rather than cut. */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  words: string,
  font: string,
  at: { x: number; y: number; width: number },
  px: number,
): void {
  ctx.fillStyle = accent;
  ctx.font = `600 ${String(px)}px ${font}`;
  const needed = ctx.measureText(words).width;
  if (needed > at.width) ctx.font = `600 ${String(Math.floor((px * at.width) / needed))}px ${font}`;
  ctx.fillText(words, at.x, at.y);
}

function drawWide(ctx: CanvasRenderingContext2D, text: SourcesText, font: string): void {
  const { width, height } = CARD_SIZES.wide;
  const margin = 64;
  paintCard(ctx, width, height, 10);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = `700 46px ${font}`;
  ctx.fillText(text.title, margin, 104);
  ctx.fillStyle = muted;
  ctx.font = `400 30px ${font}`;
  ctx.fillText(text.subtitle, margin, 152);
  if (text.badge) drawBadge(ctx, text.badge, font, { x: margin, y: 190, width: width - 2 * margin }, 21);

  const centre = { x: margin + 150, y: 352 };
  drawRing(ctx, centre, { outer: 150, inner: 96 }, text.legend, top);
  drawCentre(ctx, text.centre, font, centre, { value: 56, label: 22 }, 2 * 96 - 28);
  // the legend is centred on the ring's height, whatever the number of rows
  const row = 46;
  drawLegend(
    ctx,
    text.legend,
    font,
    { x: 420, y: centre.y + 9 - ((text.legend.length - 1) * row) / 2, width: 340 },
    { text: 26, row },
  );
  text.figures.forEach((figure, at) => {
    drawFigure(
      ctx,
      figure,
      font,
      { x: 830, y: 262 + at * 112, width: width - margin - 830 },
      { value: 50, unit: 26, label: 21 },
    );
  });
  if (text.sentence) {
    ctx.fillStyle = ink;
    ctx.font = `500 24px ${font}`;
    ctx.fillText(text.sentence, margin, 554);
  }
  ctx.fillStyle = muted;
  ctx.font = `400 21px ${font}`;
  ctx.fillText(text.footer, margin, height - 34);
}

function drawStory(ctx: CanvasRenderingContext2D, text: SourcesText, font: string): void {
  const { width, height } = CARD_SIZES.story;
  const margin = 96;
  const room = width - 2 * margin;
  const measure = (each: string): number => ctx.measureText(each).width;
  paintCard(ctx, width, height, 16);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let y = 250;
  ctx.fillStyle = ink;
  ctx.font = `700 60px ${font}`;
  for (const line of wrap(measure, text.title, room)) {
    ctx.fillText(line, margin, y);
    y += 72;
  }
  ctx.fillStyle = muted;
  ctx.font = `400 39px ${font}`;
  ctx.fillText(text.subtitle, margin, y + 10);
  if (text.badge) drawBadge(ctx, text.badge, font, { x: margin, y: y + 64, width: room }, 30);

  const centre = { x: width / 2, y: y + 290 };
  drawRing(ctx, centre, { outer: 200, inner: 128 }, text.legend, top);
  drawCentre(ctx, text.centre, font, centre, { value: 80, label: 32 }, 2 * 128 - 44);
  // six rows of sources, three figures and a sentence of two lines have to end clear of the footer
  const legendRow = 58;
  const legendTop = centre.y + 200 + 64;
  drawLegend(ctx, text.legend, font, { x: margin, y: legendTop, width: room }, { text: 38, row: legendRow });

  const figuresTop = legendTop + text.legend.length * legendRow + 64;
  const column = room / Math.max(text.figures.length, 1);
  text.figures.forEach((figure, at) => {
    drawFigure(
      ctx,
      figure,
      font,
      { x: margin + at * column, y: figuresTop, width: column - 32 },
      { value: 62, unit: 30, label: 27 },
    );
  });
  if (text.sentence) {
    ctx.fillStyle = ink;
    ctx.font = `500 34px ${font}`;
    let line = figuresTop + 142;
    for (const each of wrap(measure, text.sentence, room)) {
      ctx.fillText(each, margin, line);
      line += 46;
    }
  }
  ctx.fillStyle = muted;
  ctx.font = `400 32px ${font}`;
  const footer = wrap(measure, text.footer, room);
  footer.forEach((line, at) => {
    ctx.fillText(line, margin, height - 210 - (footer.length - 1 - at) * 42);
  });
}

/** Draw the picture on a canvas of the format's size (CARD_SIZES). */
export function drawSourcesCard(
  ctx: CanvasRenderingContext2D,
  text: SourcesText,
  font: string,
  format: CardFormat = "wide",
): void {
  if (format === "story") drawStory(ctx, text, font);
  else drawWide(ctx, text, font);
}
