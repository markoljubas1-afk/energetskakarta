/**
 * Key figures and charts of the static pages (Faza 54-2), drawn when the page is built: HTML for the words and
 * numbers, small SVGs for the bars. No script, and no `style` attribute anywhere (the content security policy
 * of the pages allows only the one stylesheet), so a bar's length is a `<rect>` attribute and its colour a class.
 *
 * A chart repeats a table that is on the same page, so it is hidden from assistive technology and the table
 * stays the accessible copy. The SVGs use only rect, line and g: the Markdown converter (markdown.ts) reads
 * `<p…>` as a paragraph, and `<path>` or `<polyline>` would look like one.
 */
import { type Technology } from "../domain";
import { escapeHtml as e } from "./markup";

/** One tile of the key figures: a label, a value with its unit and, below, what it is compared with. */
export interface KeyFigure {
  label: string;
  value: string;
  unit: string;
  /** the change against an earlier period, when there is one to compare with */
  change?: Change;
  /** a line under the value, plain text */
  note?: string;
}

export interface Change {
  /** signed, in the unit of `text` (points or per cent) */
  value: number;
  /** "3,4 p. b.", "14,7 %": the size of the change, formatted, without a sign */
  text: string;
  /** what it is compared with: "prema listopadu 2025." */
  against: string;
  /** whether a rise is good news (renewable share), bad news (CO₂) or neither (generation) */
  rise: "good" | "bad" | "neutral";
}

function changeHtml(change: Change): string {
  const tone =
    change.rise === "neutral" || change.value === 0
      ? "neutral"
      : change.value > 0 === (change.rise === "good")
        ? "good"
        : "bad";
  const arrow = change.value > 0 ? "▲" : change.value < 0 ? "▼" : "=";
  return `<span class="delta ${tone}"><b aria-hidden="true">${arrow}</b> ${e(change.text)}</span> ${e(change.against)}`;
}

/** The tiles, in a row of up to four on a wide screen, two on a phone. */
export function keyFigures(figures: readonly KeyFigure[], label: string): string {
  if (figures.length === 0) return "";
  const tiles = figures.map(
    (figure, index) =>
      `<div class="kpi${index === 0 ? " main" : ""}"><p class="label">${e(figure.label)}</p><p class="big">${e(figure.value)}<small>${e(figure.unit)}</small></p>${
        figure.change ? `<p>${changeHtml(figure.change)}</p>` : ""
      }${figure.note ? `<p>${e(figure.note)}</p>` : ""}</div>`,
  );
  return `<section class="kpis" aria-label="${e(label)}">${tiles.join("")}</section>`;
}

/** "879 GWh" → ["879", "GWh"]: the number and its unit, for a tile. */
export function splitUnit(text: string): [string, string] {
  const at = text.lastIndexOf(" ");
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1)];
}

/** Width in the 0–1000 space of the bars' SVG, never less than a sliver for a value above zero. */
const span = (value: number, max: number): number =>
  max > 0 && value > 0 ? Math.max(4, Math.round((value / max) * 1000)) : 0;

const bar = (cls: string, value: number, max: number, y = 0, height = 10): string =>
  `<rect class="${cls}" x="0" y="${String(y)}" width="${String(span(value, max))}" height="${String(height)}" rx="2"/>`;

const svg = (body: string, height: number): string =>
  `<svg viewBox="0 0 1000 ${String(height)}" preserveAspectRatio="none" focusable="false">${body}</svg>`;

/** The mix of a period in one bar, each source its share, in the order given. */
export function mixBar(parts: readonly { tech: Technology; value: number }[]): string {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  if (total <= 0) return "";
  let x = 0;
  const rects = parts
    .filter((part) => part.value > 0)
    .map((part) => {
      const width = (part.value / total) * 1000;
      const rect = `<rect class="t-${part.tech}" x="${x.toFixed(1)}" y="0" width="${Math.max(0, width - 3).toFixed(1)}" height="10"/>`;
      x += width;
      return rect;
    });
  return `<div class="mix" aria-hidden="true">${svg(rects.join(""), 10)}</div>`;
}

export interface SourceBar {
  tech: Technology;
  name: string;
  /** "313 GWh" */
  amount: string;
  /** "35,6 %" */
  share: string;
  value: number;
  /** the same source in the period compared with; null when that period is unknown or had none */
  before: number | null;
  /** the change against `before`, formatted ("▼ 4,9 %"), or "novo" for a source that had none */
  change: string;
}

/** One row per source: its bar, a thin bar for the period compared with, the amount, share and change. */
export function sourceBars(rows: readonly SourceBar[], legend: { now: string; before: string }): string {
  const max = Math.max(...rows.flatMap((row) => [row.value, row.before ?? 0]));
  const items = rows.map(
    (row) =>
      `<div class="srow"><span class="sname"><i class="t-${row.tech}"></i>${e(row.name)}</span><span class="sbar">${svg(
        bar(`t-${row.tech}`, row.value, max, 0, 13) +
          (row.before === null ? "" : bar("was", row.before, max, 16, 5)),
        21,
      )}</span><span class="sval"><b>${e(row.amount)}</b> <small>${e(row.share)}</small></span><span class="schg">${e(row.change)}</span></div>`,
  );
  const was = legend.before && rows.some((row) => row.before !== null);
  return `<div class="sources" aria-hidden="true">${items.join("")}<div class="key"><span><i class="now"></i>${e(legend.now)}</span>${
    was ? `<span><i class="was"></i>${e(legend.before)}</span>` : ""
  }</div></div>`;
}

export interface Column {
  /** short label under the column ("lis 26") or "" to leave it unlabelled */
  label: string;
  /** 0–1, or null for a gap (a month without complete data is not a zero) */
  value: number | null;
  /** the period the page is about, and the one it is compared with: drawn darker */
  mark?: "now" | "then";
}

/** Columns of a share (0–100 %), with grid lines at every quarter and the labels in HTML under them. */
export function shareColumns(columns: readonly Column[], gap: string): string {
  const count = columns.length;
  if (count === 0) return "";
  const width = 1000 / count;
  const grid = [0, 25, 50, 75, 100]
    .map(
      (level) => `<line x1="0" x2="1000" y1="${String(200 - level * 2)}" y2="${String(200 - level * 2)}"/>`,
    )
    .join("");
  const rects = columns
    .map((column, index) => {
      if (column.value === null) return "";
      const height = Math.max(1, Math.min(1, column.value) * 200);
      return `<rect class="col${column.mark ? ` ${column.mark}` : ""}" x="${(index * width + width * 0.14).toFixed(1)}" y="${(200 - height).toFixed(1)}" width="${(width * 0.72).toFixed(1)}" height="${height.toFixed(1)}" rx="3"/>`;
    })
    .join("");
  const labels = columns
    .map(
      (column) =>
        `<span${column.mark === "now" ? ' class="now"' : ""}>${e(column.label)}${column.value === null && column.label ? ` <small>${e(gap)}</small>` : ""}</span>`,
    )
    .join("");
  return `<div class="columns" aria-hidden="true"><div class="axis"><span>100 %</span><span>50 %</span><span>0 %</span></div>${svg(`<g class="grid">${grid}</g>${rects}`, 200)}<div class="ticks">${labels}</div></div>`;
}

export interface RankRow {
  /** HTML: the name, usually a link */
  name: string;
  /** 0–1 */
  value: number;
  /** "65,9 %" */
  text: string;
  /** a second line under the value: "173 g/kWh · Hidro" */
  detail: string;
  /** the row the page is about */
  own?: boolean;
}

/** A ranking with a bar of a share (0–100 %) per row. */
export function rankBars(rows: readonly RankRow[]): string {
  const items = rows.map(
    (row) =>
      `<div class="rrow${row.own ? " own" : ""}"><span class="rname">${row.name}</span><span class="rbar">${svg(
        `<rect class="track" x="0" y="0" width="1000" height="10" rx="5"/>${bar("fill", row.value, 1, 0, 10)}`,
        10,
      )}</span><span class="sval"><b>${e(row.text)}</b> <small>${e(row.detail)}</small></span></div>`,
  );
  return `<div class="ranking">${items.join("")}</div>`;
}

/** A table behind a summary line, for the reader who wants the exact figures under a chart. */
export function tableBehind(summary: string, table: string): string {
  return `<details class="data"><summary>${e(summary)}</summary>${table}</details>`;
}
