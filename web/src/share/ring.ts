/**
 * A ring chart (a pie with a hole) drawn on a canvas: the one drawing behind the pictures for sharing and the
 * "share of sources" card of the energy page (Faza 41-2). The hole is where the headline figure is written.
 */

export interface RingPart {
  /** any non-negative weight; the ring shows each part's share of their sum */
  share: number;
  colour: string;
}

export interface RingArc {
  /** radians, clockwise from twelve o'clock (canvas angles: -π/2 is the top) */
  start: number;
  end: number;
  colour: string;
}

const TOP = -Math.PI / 2;

/** Where each part starts and ends; parts without weight are left out. Pure, so it can be checked. */
export function ringArcs(parts: readonly RingPart[]): RingArc[] {
  const shown = parts.filter((part) => part.share > 0);
  const total = shown.reduce((sum, part) => sum + part.share, 0);
  if (!(total > 0)) return [];
  let at = TOP;
  return shown.map((part, index) => {
    const start = at;
    // the last arc closes the circle exactly, whatever the rounding before it
    at = index === shown.length - 1 ? TOP + 2 * Math.PI : at + (part.share / total) * 2 * Math.PI;
    return { start, end: at, colour: part.colour };
  });
}

/** Draw the ring; `gap` is the colour of the thin line between neighbouring parts (the background). */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  centre: { x: number; y: number },
  radius: { outer: number; inner: number },
  parts: readonly RingPart[],
  gap: string,
): void {
  const arcs = ringArcs(parts);
  for (const arc of arcs) {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius.outer, arc.start, arc.end);
    ctx.arc(centre.x, centre.y, radius.inner, arc.end, arc.start, true);
    ctx.closePath();
    ctx.fillStyle = arc.colour;
    ctx.fill();
  }
  if (arcs.length < 2) return;
  ctx.strokeStyle = gap;
  ctx.lineWidth = Math.max(2, radius.outer / 80);
  for (const arc of arcs) {
    ctx.beginPath();
    ctx.moveTo(centre.x + radius.inner * Math.cos(arc.start), centre.y + radius.inner * Math.sin(arc.start));
    ctx.lineTo(centre.x + radius.outer * Math.cos(arc.start), centre.y + radius.outer * Math.sin(arc.start));
    ctx.stroke();
  }
}
