/**
 * Draws the site's icon in the sizes and formats that browsers, phones and search engines ask for, from
 * public/favicon.svg (Faza 51-4): favicon.ico (32 and 16 px, PNG inside, as every browser since 2009 reads),
 * apple-touch-icon.png (180 px) and the two icons of site.webmanifest (192 and 512 px). Bing and some
 * crawlers ask for /favicon.ico whatever the page says, and an iPhone for /apple-touch-icon.png.
 *
 *   node scripts/icons.mjs           (needs a Chromium: PW_CHROMIUM_PATH, or Playwright's own)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = new URL("..", import.meta.url);
const svg = readFileSync(new URL("public/favicon.svg", root), "utf8");

const executablePath = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});

async function png(size) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`,
  );
  const bytes = await page.screenshot({ type: "png", omitBackground: true });
  await page.close();
  return bytes;
}

/** An ICO file holding PNG images (ICONDIR, one ICONDIRENTRY per image, then the images). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, bytes }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(bytes.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += bytes.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ bytes }) => bytes)]);
}

const write = (name, bytes) => {
  const target = fileURLToPath(new URL(`public/${name}`, root));
  writeFileSync(target, bytes);
  console.log(`${target}: ${bytes.length} bytes`);
};

write(
  "favicon.ico",
  ico([
    { size: 32, bytes: await png(32) },
    { size: 16, bytes: await png(16) },
  ]),
);
write("apple-touch-icon.png", await png(180));
write("icon-192.png", await png(192));
write("icon-512.png", await png(512));
await browser.close();
