import { expect, test, type Page } from "@playwright/test";

/** The line above the map for something out of the ordinary (data/alerts.ts). */

interface LiveDoc {
  hours: string[];
  prices: Record<string, { zone: string; eurPerMwh: (number | null)[] }>;
}

/** The test data with tomorrow 13:00 priced at -12.5 €/MWh in Croatia, and the clock at today's noon. */
async function withFreeHourTomorrow(page: Page): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  const response = await page.request.get("/local-data/live/current.json");
  const live = (await response.json()) as LiveDoc;
  // the document holds three days: yesterday, today, tomorrow
  const noon = live.hours[36];
  const croatia = live.prices.HR;
  if (noon === undefined || !croatia) throw new Error("the test data has no Croatian prices");
  croatia.eurPerMwh[48 + 13] = -12.5;
  // the app asks with a cache-busting query
  await page.route("**/local-data/live/current.json*", (route) => route.fulfill({ json: live }));
  await page.clock.install({ time: new Date(Date.parse(noon) + 20 * 60_000) });
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("a price below zero tomorrow is announced above the map and leads to that hour", async ({
  page,
}, testInfo) => {
  await withFreeHourTomorrow(page);
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();

  const banner = page.locator('[data-alert="free"]');
  await expect(banner).toContainText("Cijena struje nula ili niže.");
  await expect(banner).toContainText(
    /Hrvatska: sutra cijena na burzi pada na nulu ili ispod nje, najniže −12,5 €\/MWh u \d\d:00\./,
  );
  await expect(banner).toContainText("račun kućanstva je ne prati");

  // it is wholly on screen and does not cover the zoom buttons
  const box = await banner.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("no box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  // nor does anything lie over it: the status bar's share button is clear of it
  const share = await page.getByRole("button", { name: "Podijeli", exact: true }).boundingBox();
  if (!share) throw new Error("no share button");
  const apart =
    share.x + share.width <= box.x ||
    box.x + box.width <= share.x ||
    share.y + share.height <= box.y ||
    box.y + box.height <= share.y;
  expect(apart).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("alert.png") });

  await banner.getByRole("button", { name: "Prikaži taj sat na karti" }).click();
  await expect(page).toHaveURL(/[?&]live=1/);
  await expect(page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" })).toBeVisible();
  // the live bar says the same thing in full: the line above the map steps aside
  await expect(banner).toBeHidden();
});

test("a closed notice stays closed on the next visit", async ({ page }) => {
  await withFreeHourTomorrow(page);
  await page.goto("/");
  const banner = page.locator('[data-alert="free"]');
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Zatvori obavijest" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(banner).toBeHidden();
});

test("an ordinary day has no notice", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.locator("[data-alert]")).toHaveCount(0);
});
