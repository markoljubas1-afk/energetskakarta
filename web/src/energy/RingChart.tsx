/**
 * The share of each source as a ring with its legend, drawn on one canvas so that the picture saved from the
 * card carries both (Faza 41-2). The same ring drawing as the pictures for sharing (share/ring.ts).
 */
import { useEffect, useRef, useState } from "react";

import type { Theme } from "../map/palette";
import { pictureTheme } from "../share/download";
import { drawRing } from "../share/ring";
import styles from "./EnergyView.module.css";

export interface RingRow {
  label: string;
  colour: string;
  share: number;
  /** "45 %" */
  percent: string;
  /** "320 GWh" */
  amount: string;
}

interface Props {
  rows: readonly RingRow[];
  /** written in the ring's hole */
  centre: { value: string; label: string };
  /** the chart in words, for a screen reader */
  description: string;
  /** redraw when the theme changes: the colours are read from the page */
  theme: Theme;
}

export interface RingLayout {
  height: number;
  centre: { x: number; y: number };
  radius: { outer: number; inner: number };
  legend: { x: number; y: number; row: number; right: number };
}

/** From this width the legend stands beside the ring; under it the legend goes below. */
export const SIDE_BY_SIDE_FROM = 520;
const ROW = 28;

/** Where the ring and the legend go for a width (CSS pixels) and a number of rows. Pure, so it is checked. */
export function ringLayout(width: number, rows: number): RingLayout {
  if (width >= SIDE_BY_SIDE_FROM) {
    const height = Math.max(252, rows * ROW + 32);
    return {
      height,
      centre: { x: 126, y: height / 2 },
      radius: { outer: 110, inner: 70 },
      // on a wide card the legend stays beside the ring instead of spreading to the far edge
      legend: {
        x: 270,
        y: height / 2 - ((rows - 1) * ROW) / 2 + 5,
        row: ROW,
        right: Math.min(width - 8, 700),
      },
    };
  }
  const outer = Math.min(106, Math.max(60, width / 2 - 16));
  return {
    height: 2 * outer + 46 + rows * ROW,
    centre: { x: width / 2, y: outer + 10 },
    radius: { outer, inner: Math.round(outer * 0.64) },
    legend: { x: 8, y: 2 * outer + 50, row: ROW, right: width - 8 },
  };
}

function draw(
  canvas: HTMLCanvasElement,
  width: number,
  rows: readonly RingRow[],
  centre: Props["centre"],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const scale = window.devicePixelRatio || 1;
  const layout = ringLayout(width, rows.length);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(layout.height * scale);
  const colours = pictureTheme(canvas);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = colours.background;
  ctx.fillRect(0, 0, width, layout.height);
  drawRing(ctx, layout.centre, layout.radius, rows, colours.background);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = colours.ink;
  ctx.font = `700 30px ${colours.font}`;
  ctx.fillText(centre.value, layout.centre.x, layout.centre.y + 6);
  ctx.fillStyle = colours.muted;
  ctx.font = `400 13px ${colours.font}`;
  ctx.fillText(centre.label, layout.centre.x, layout.centre.y + 26);

  rows.forEach((row, at) => {
    const y = layout.legend.y + at * layout.legend.row;
    ctx.fillStyle = row.colour;
    ctx.beginPath();
    ctx.arc(layout.legend.x + 6, y - 5, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = colours.ink;
    ctx.font = `400 14px ${colours.font}`;
    ctx.fillText(row.label, layout.legend.x + 20, y);
    ctx.textAlign = "right";
    ctx.fillStyle = colours.muted;
    ctx.fillText(row.amount, layout.legend.right, y);
    ctx.fillStyle = colours.ink;
    ctx.font = `700 14px ${colours.font}`;
    ctx.fillText(row.percent, layout.legend.right - 96, y);
  });
  ctx.textAlign = "left";
}

export function RingChart({ rows, centre, description, theme }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // the width the canvas is drawn for; a browser without ResizeObserver keeps the first one
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // what is drawn is what `description` says: redraw when the words, the width or the theme change
  const latest = useRef({ rows, centre });
  useEffect(() => {
    latest.current = { rows, centre };
  });
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    draw(element, width, latest.current.rows, latest.current.centre);
  }, [width, description, theme]);

  return (
    <div ref={box} className={styles.ring}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={description}
        style={{ width: `${String(width)}px`, height: `${String(ringLayout(width, rows.length).height)}px` }}
      />
    </div>
  );
}
