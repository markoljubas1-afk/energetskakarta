import { expect, test, type Page } from "@playwright/test";

/** Fixture charging station: node 72, "Punionica Primjer" at 15.85,45.70, four charging points. */
const CHARGER = "osm:node/72";

async function open(page: Page, query: string): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/?${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the archive is left alone until the layer is switched on", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("chargers.pmtiles")) requests.push(request.url());
  });
  await open(page, "v=45.70,15.85,12");
  await page.waitForTimeout(1000);
  expect(requests).toEqual([]);

  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("checkbox", { name: "Punionice (EV)" }).check();
  await expect(page).toHaveURL(/chargers/);
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("a shared link opens a charging station with its points", async ({ page }) => {
  await open(page, `l=chargers&v=45.70,15.85,12&sel=${encodeURIComponent(CHARGER)}`);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "Punionica Primjer" })).toBeVisible();
  await expect(details).toContainText("Punionica za električna vozila");
  await expect(details).toContainText("Mjesta za punjenje");
  await expect(details).toContainText("4");
  await expect(details.getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();
});

test("charging stations are not in the search index", async ({ page }) => {
  // the index is downloaded by everyone, so tens of thousands of generic names stay out of it
  await open(page, "v=45.70,15.85,12");
  await page.getByRole("combobox", { name: "Pretraga" }).fill("punionica");
  await expect(page.getByText(/Nema rezultata/)).toBeVisible();
});

test("charging stations snapshot", async ({ page }, testInfo) => {
  await open(page, `l=chargers,plants&v=45.70,15.85,12&sel=${encodeURIComponent(CHARGER)}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-chargers.png`) });
});
