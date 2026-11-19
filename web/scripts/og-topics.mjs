/**
 * Draws the pictures a shared link to a topic page shows (1200 x 630), next to public/og-gridatlas.png
 * (scripts/og-image.mjs): the same night and wordmark, with the topic's name under it (Faza 47-7).
 * Like that picture they carry no figures, so they never go out of date: the day's numbers are on the
 * page, and in the pictures the visitor makes there ("?pic=...").
 *
 *   node scripts/og-topics.mjs           (needs a Chromium: PW_CHROMIUM_PATH, or Playwright's own)
 *
 * The names of the files are the ones in src/seo/ogImages.ts; a test there checks that each exists.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = new URL("..", import.meta.url);
const font = (subset, weight) =>
  readFileSync(
    new URL(
      `node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-${subset}-${weight}-normal.woff2`,
      root,
    ),
  ).toString("base64");
// the letters with marks (č, š, ž) are in the extended subset
const face = (subset, weight, range) =>
  `@font-face{font-family:"Plex";font-weight:${weight};src:url(data:font/woff2;base64,${font(subset, weight)}) format("woff2");unicode-range:${range}}`;
const LATIN = "U+0000-00FF,U+2013-2014,U+2018-201E";
const LATIN_EXT = "U+0100-024F";

const NIGHT = "#0e151c";
const INK = "#eef3f7";
const WARM = "#ffc680";
const COOL = "#5fb0cc";
const mix = (share) => `color-mix(in srgb, ${WARM} ${share}%, ${COOL})`;
const letters = [
  ["A", 100],
  ["t", 75],
  ["l", 50],
  ["a", 25],
  ["s", 0],
]
  .map(([letter, share]) => `<span style="color:${mix(share)}">${letter}</span>`)
  .join("");

/** file → the topic's name and the line under it */
const TOPICS = {
  "og-plin.png": ["Plin u Hrvatskoj", "ulaz, isporuka i skladište, dan po dan"],
  "og-gas.png": ["Gas in Croatia", "inflow, deliveries and storage, day by day"],
  "og-tranzicija.png": ["Zelena tranzicija", "pokazatelji za Hrvatsku, iz otvorenih podataka"],
  "og-transition.png": ["Energy transition", "indicators for Croatia, from open data"],
  "og-izvjestaj.png": ["Mjesečni izvještaj", "struja u Hrvatskoj, mjesec po mjesec"],
  "og-report.png": ["Monthly report", "electricity in Croatia, month by month"],
};

const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const html = (title, line) => `<!doctype html><html><head><meta charset="utf-8"><style>
${face("latin", 700, LATIN)}${face("latin-ext", 700, LATIN_EXT)}
${face("latin", 500, LATIN)}${face("latin-ext", 500, LATIN_EXT)}
html,body{margin:0}
body{width:1200px;height:630px;display:grid;place-items:center;background:
  radial-gradient(ellipse 70% 60% at 50% 46%, #17222d 0%, ${NIGHT} 70%);font-family:"Plex",sans-serif;color:${INK}}
.wrap{text-align:center}
.mark{font-size:76px;font-weight:700;letter-spacing:-0.04em;line-height:1;
  filter:drop-shadow(0 0 22px color-mix(in srgb, ${WARM} 30%, transparent))}
.rule{width:420px;height:3px;margin:22px auto 0;border-radius:2px;
  background:linear-gradient(90deg,transparent,${WARM},${COOL},transparent);
  box-shadow:0 0 18px color-mix(in srgb, ${WARM} 60%, transparent)}
.title{margin-top:44px;font-size:104px;font-weight:700;letter-spacing:-0.03em;line-height:1.05}
.line{margin-top:26px;font-size:34px;font-weight:500;color:color-mix(in srgb, ${INK} 78%, transparent)}
</style></head><body><div class="wrap"><div class="mark">Grid${letters}</div><div class="rule"></div>
<div class="title">${escape(title)}</div><div class="line">${escape(line)}</div></div></body></html>`;

const executablePath = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [file, [title, line]] of Object.entries(TOPICS)) {
  await page.setContent(html(title, line));
  await page.evaluate(() => document.fonts.ready);
  // the title must fit the picture with air on both sides
  const width = await page.evaluate(() => document.querySelector(".title").scrollWidth);
  if (width > 1080) throw new Error(`${file}: the title is ${width}px wide, more than the picture holds`);
  const png = await page.screenshot({ type: "png" });
  const target = fileURLToPath(new URL(`public/${file}`, root));
  writeFileSync(target, png);
  console.log(`${target}: ${png.length} bytes`);
}
await browser.close();
