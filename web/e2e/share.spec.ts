import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function openMap(page: Page, query = ""): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the picture of the view downloads as a PNG that is taller than the map (credits underneath)", async ({
  page,
}) => {
  await openMap(page, "?v=45.81,16.51,12");
  await page.getByRole("button", { name: "Podijeli", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^energetska-karta-\d{4}-\d{2}-\d{2}-\d{4}\.png$/);
  const path = await download.path();
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  // IHDR: width and height are big-endian at offsets 16 and 20
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const canvas = await page.locator("canvas.maplibregl-canvas").evaluate((c: HTMLCanvasElement) => ({
    width: c.width,
    height: c.height,
  }));
  expect(width).toBe(canvas.width);
  expect(height).toBeGreaterThan(canvas.height);
  // the menu still explains what the picture carries
  await expect(page.getByText(/Slika nosi atribuciju/)).toBeVisible();
});

test("the link of the current view is copied to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are only scriptable in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMap(page, "?v=45.81,16.51,12&l=plants");
  await page.getByRole("button", { name: "Podijeli", exact: true }).click();
  await page.getByRole("button", { name: "Kopiraj poveznicu" }).click();
  await expect(page.getByRole("status")).toHaveText("Poveznica je kopirana.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
  expect(copied).toContain("l=plants");
});
