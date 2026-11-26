import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// read as a file: the test setup replaces CSS imports with nothing
const tokens = readFileSync(resolve(import.meta.dirname, "tokens.css"), "utf8");

/** The custom properties of one theme block, as written (hex colours only). */
function theme(selector: string): Record<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  const block = tokens.slice(start, tokens.indexOf("}", start));
  const colours: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
    if (name && value) colours[name] = value;
  }
  return colours;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const THEMES = { light: theme(":root"), dark: theme(':root[data-theme="dark"]') };
const GROUNDS = ["canvas", "surface", "surface-2"];

describe.each(Object.entries(THEMES))("colours of the %s theme (Faza 57, WCAG AA)", (_, colours) => {
  const colour = (name: string): string => {
    const value = colours[name];
    if (!value) throw new Error(`no --${name}`);
    return value;
  };

  it.each(["ink", "muted", "accent", "ok", "danger"])(
    "--%s reads as text on every ground (4.5:1)",
    (text) => {
      for (const ground of GROUNDS)
        expect(contrast(colour(text), colour(ground))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("text on the accent colour reads (4.5:1)", () => {
    expect(contrast(colour("on-accent"), colour("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the edge of a field or a chip is visible (3:1)", () => {
    for (const ground of ["surface", "surface-2"]) {
      expect(contrast(colour("line-strong"), colour(ground))).toBeGreaterThanOrEqual(3);
    }
  });
});
