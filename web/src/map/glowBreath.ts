/**
 * The grid breathes: every so often the glow under the transmission lines swells a little and settles
 * again, like a light that is on rather than painted. It is deliberately not a moving pattern along the
 * lines: that would read as the direction of a flow, and the map only shows flows where it has them (the
 * live layer's arcs).
 *
 * The map is drawn only while the glow changes (two short fades per breath) and rests in between, so the
 * effect costs a few seconds of rendering a minute, not a permanent animation loop.
 */

/** From one breath to the next. */
export const BREATH_EVERY_MS = 9000;
/** One fade, up or down; a breath is two of them. */
export const BREATH_FADE_MS = 1600;
/** Between two steps of a fade: about ten a second is smooth under the map's own 400 ms paint transition. */
export const BREATH_STEP_MS = 100;
/** How much brighter the glow gets at the top of a breath. */
export const BREATH_GAIN = 1.7;

/** The glow's opacity at the top of a breath; never more than fully opaque. */
export function breathPeak(resting: number): number {
  return Math.min(1, Math.round(resting * BREATH_GAIN * 1000) / 1000);
}

export interface BreathOptions {
  /** the theme's own glow; 0 means the theme has none (the light theme) */
  resting: number;
  linesShown: boolean;
  reducedMotion: boolean;
  /** the intro is playing its own lights */
  intro: boolean;
  /** a spotlight decides the glow's opacity per feature while it is on */
  spotlight: boolean;
}

/** Whether the grid breathes at all in this state. */
export function breathes({ resting, linesShown, reducedMotion, intro, spotlight }: BreathOptions): boolean {
  return resting > 0 && linesShown && !reducedMotion && !intro && !spotlight;
}
