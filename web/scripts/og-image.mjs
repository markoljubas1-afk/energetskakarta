/**
 * Draws public/og-gridatlas.png, the picture a shared link shows (1200 x 630): the GridAtlas wordmark on the intro's
 * night, as the intro writes it (src/app/Intro.module.css), with the line of light and what the site is.
 * Nothing else: no map and no figures, so the picture never goes out of date (decision 2026-11-16).
 *
 *   node scripts/og-image.mjs            (needs a Chromium: PW_CHROMIUM_PATH, or Playwright's own)
 *
 * The font is the site's own (IBM Plex Sans from @fontsource), embedded in the page, so the picture does
 * not depend on what the machine has installed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = new URL("..", import.meta.url);
const font = (weight) =>
  readFileSync(
    new URL(`node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff2`, root),
  ).toString("base64");

const NIGHT = "#0e151c";
const INK = "#eef3f7";
const WARM = "#ffc680";
const COOL = "#5fb0cc";
// "Atlas" letter by letter from the warm light to the cool one, as in the intro
const mix = (share) => `color-mix(in srgb, ${WARM} ${share}%, ${COOL})`;
const atlas = [...["A", 100], ...["t", 75], ...["l", 50], ...["a", 25], ...["s", 0]];
const letters = [];
for (let i = 0; i < atlas.length; i += 2)
  letters.push(`<span style="color:${mix(atlas[i + 1])}">${atlas[i]}</span>`);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Plex";font-weight:700;src:url(data:font/woff2;base64,${font(700)}) format("woff2")}
@font-face{font-family:"Plex";font-weight:500;src:url(data:font/woff2;base64,${font(500)}) format("woff2")}
html,body{margin:0}
body{width:1200px;height:630px;display:grid;place-items:center;background:
  radial-gradient(ellipse 70% 60% at 50% 46%, #17222d 0%, ${NIGHT} 70%);font-family:"Plex",sans-serif;color:${INK}}
.mark{font-size:176px;font-weight:700;letter-spacing:-0.04em;line-height:1;
  filter:drop-shadow(0 0 34px color-mix(in srgb, ${WARM} 30%, transparent))}
.rule{width:620px;height:3px;margin:30px auto 0;border-radius:2px;
  background:linear-gradient(90deg,transparent,${WARM},${COOL},transparent);
  box-shadow:0 0 18px color-mix(in srgb, ${WARM} 60%, transparent)}
.what{margin-top:28px;text-align:center;font-size:34px;font-weight:500;
  color:color-mix(in srgb, ${INK} 78%, transparent)}
</style></head><body><div><div class="mark">Grid${letters.join("")}</div><div class="rule"></div>
<div class="what">Regionalna energetska karta</div></div></body></html>`;

const executablePath = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: "png" });
await browser.close();
const target = fileURLToPath(new URL("public/og-gridatlas.png", root));
writeFileSync(target, png);
console.log(`${target}: ${png.length} bytes`);
