import { expect, test, type Page } from "@playwright/test";

/** Distribution sample from pipeline/tests/fixtures/sample.osm: ways 104 (20 kV minor_line), 105 (35 kV
 * line) and 107 (cable without a voltage tag) run between 16.00,45.30 and 16.10,45.30; node 62 is a
 * minor_distribution substation at 16.20,45.35. */
const MINOR_LINE = "osm:way/104";
const ALL_LAYERS = "lines,substations,plants,pipelines,distribution";

async function open(page: Page, query: string): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/?${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
}

/** Every request for the distribution archive, however MapLibre splits it into byte ranges. */
function archiveRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("distribution.pmtiles")) seen.push(request.url());
  });
  return seen;
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the archive is left alone until the layer is switched on", async ({ page }) => {
  const requests = archiveRequests(page);
  // zoomed in far enough that the layer would be drawn if it were on
  await open(page, "v=45.30,16.05,12");
  await page.waitForTimeout(1000);
  expect(requests).toEqual([]);

  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("checkbox", { name: "Distribucijska mreža" }).check();

  await expect(page).toHaveURL(/distribution/);
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("a distribution line can be opened from a shared link, with its own voltage class", async ({ page }) => {
  await open(page, `l=${ALL_LAYERS}&v=45.30,16.05,12&sel=${encodeURIComponent(MINOR_LINE)}`);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details).toContainText("20 kV");
  await expect(details.getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();
});

test("the legend names the sub-60 kV class while the layer is on", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the legend is hidden on phones by design");
  await open(page, "v=45.30,16.05,12");
  const legend = page.locator("details", { hasText: "Legenda" });
  // folded while the welcome card is up (they share the right edge): open it as a reader would
  const unfold = async (): Promise<void> => {
    if (!(await legend.evaluate((el: HTMLDetailsElement) => el.open)))
      await legend.locator("summary").click();
  };
  await unfold();
  await expect(legend.getByText("110–219 kV")).toBeVisible();
  await expect(legend.getByText("Ispod 60 kV")).toHaveCount(0);

  await page.goto(`/?l=${ALL_LAYERS}&v=45.30,16.05,12`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await unfold();
  await expect(legend.getByText("Ispod 60 kV")).toBeVisible();
});

test("a distribution line is clickable, and the voltage filter reaches it", async ({ page }) => {
  await open(page, `l=${ALL_LAYERS}&v=45.30,16.05,12`);
  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.click(center.x, center.y);
  await expect(page).toHaveURL(/sel=osm%3Away%2F10/);
  await page.getByRole("button", { name: "Zatvori detalje" }).click();

  // keep only the transmission voltage classes: nothing in the distribution layer may answer a click
  await page.goto(`/?l=${ALL_LAYERS}&v=45.30,16.05,12&kv=380%2B,220-379,110-219,60-109`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await page.mouse.click(center.x, center.y);
  await expect(page).not.toHaveURL(/sel=/);
});

test("distribution files are offered for download", async ({ page }) => {
  await open(page, "v=45.30,16.05,12");
  await page.getByRole("button", { name: "Preuzmi bazu", exact: true }).click();
  await expect(page.getByRole("link", { name: "Distribucijski vodovi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Distribucijske trafostanice" })).toBeVisible();
});

test("distribution snapshot", async ({ page }, testInfo) => {
  await open(page, `l=${ALL_LAYERS}&v=45.32,16.10,11`);
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-distribution.png`),
    fullPage: false,
  });
});
