import { expect, test, type Page } from "@playwright/test";

/*
 * The first-visit intro (Faza 22). The page treats automated browsers like returning visitors, which keeps
 * every other test on the plain map; here the browser presents itself as a person's.
 */

const overlay = (page: Page) => page.locator("[data-intro-overlay]");

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
  });
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
});

test("a first visit opens on the title, flies in, hands over to the map and does not come back", async ({
  page,
}) => {
  await page.goto("/");
  await expect(overlay(page)).toHaveAttribute("data-mode", "full");
  await expect(page.getByText("Energetska karta Hrvatske i regije")).toBeVisible();
  // the whole intro, including a slow map, is over well within the give-up time
  await expect(overlay(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.locator("[data-intro]")).toHaveCount(0);
  // the flight is not written into the link: it stays as clean as before
  expect(new URL(page.url()).search).toBe("");
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
});

test("skipping goes straight to the usable map", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preskoči uvod" }).click();
  await expect(overlay(page)).toHaveCount(0, { timeout: 3_000 });
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("a key skips it too, but Tab only moves focus to the skip button", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(overlay(page)).toHaveAttribute("data-phase", /title|play/);
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toHaveCount(0, { timeout: 3_000 });
});

test("a shared link opens on what it shares, without the intro", async ({ page }) => {
  await page.goto("/?l=lines,cities");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
});

test("with reduced motion it is only the title, which gives way to the map", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(overlay(page)).toHaveAttribute("data-mode", "still");
  await expect(overlay(page)).toHaveCount(0, { timeout: 6_000 });
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
});
