import { expect, test, type Page } from "@playwright/test";

/*
 * The day's occasion above the map (data/occasions.ts, Faza 48). The page shows it to people only: like
 * the intro it leaves automated browsers on the plain map, so every other test is the same on any day of
 * the year. Here the browser presents itself as a person's who has seen the intro.
 */

async function asPersonOn(page: Page, moment: string): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
    window.localStorage.setItem("energymap-intro", "1");
  });
  await page.clock.install({ time: new Date(moment) });
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("Tesla's birthday is greeted above the map, and a closed greeting stays closed", async ({
  page,
}, testInfo) => {
  await asPersonOn(page, "2027-07-10T09:00:00+02:00");
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const banner = page.locator('[data-alert="occasion"]');
  await expect(banner).toContainText("Dan Nikole Tesle.");
  await expect(banner).toContainText("višefazni sustav izmjenične struje");
  // wholly on screen
  const box = await banner.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("no box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: testInfo.outputPath("occasion.png") });

  await banner.getByRole("button", { name: "Zatvori obavijest" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(banner).toBeHidden();
});

test("World Wind Day leads to the live layer", async ({ page }) => {
  await asPersonOn(page, "2027-06-15T09:00:00+02:00");
  await page.goto("/");
  const banner = page.locator('[data-alert="occasion"]');
  await expect(banner).toContainText("Svjetski dan vjetra.");
  await banner.getByRole("button", { name: "Otvori tokove i cijene uživo" }).click();
  await expect(page).toHaveURL(/[?&]live=1/);
  await expect(banner).toBeHidden();
});

test("an automated browser gets no greeting, and the English page greets in English", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.clock.install({ time: new Date("2027-07-10T09:00:00+02:00") });
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.locator("[data-alert]")).toHaveCount(0);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
    window.localStorage.setItem("energymap-intro", "1");
  });
  await page.goto("/en/");
  await expect(page.locator('[data-alert="occasion"]')).toContainText("Nikola Tesla Day.");
});
