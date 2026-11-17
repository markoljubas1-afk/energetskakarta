import { expect, test, type Page } from "@playwright/test";

/** Synthetic live data from pipeline/scripts/web_fixture.py: ME–BA never reports, BA and ME have no market,
 * and SI–HR is missing for the first hour of today. */

async function openLive(page: Page, query = ""): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/?live=1${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" })).toBeVisible();
}

async function hours(page: Page): Promise<string[]> {
  const response = await page.request.get("/local-data/live/current.json");
  const body = (await response.json()) as { hours: string[] };
  return body.hours;
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the layer is switched on from the layer list and shows flows and prices", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("checkbox", { name: "Tokovi i cijene (uživo)" }).check();
  await expect(page).toHaveURL(/live=1/);
  if (await page.getByRole("button", { name: "Sakrij filtre i pregled" }).isVisible()) {
    await page.getByRole("button", { name: "Sakrij filtre i pregled" }).click();
  }
  const bar = page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" });
  await expect(bar.getByText("Testni podaci, nisu stvarni")).toBeVisible();
  await expect(page.locator('[data-live-label^="flow-"]').first()).toBeVisible();
  await expect(page.locator('[data-live-label="price-HR"]')).toContainText("€/MWh");
  await expect(page.locator('[data-live-label="price-BA"]')).toHaveCount(0); // no market, no number
});

test("an hour without data shows no arrow and says so in the table", async ({ page }) => {
  const all = await hours(page);
  const todayMidnight = all.find((h) => h.slice(0, 10) === all[36]?.slice(0, 10)) ?? "";
  await openLive(page, `&lt=${todayMidnight.slice(0, 13)}`);
  const bar = page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" });
  await expect(bar.getByText("danas 00:00")).toBeVisible();
  await expect(page.locator('[data-live-label="flow-SI-HR"]')).toHaveCount(0);
  await expect(page.locator('[data-live-label^="flow-"]').first()).toBeVisible();
  await bar.getByText("Brojke za odabrani sat").click();
  await expect(bar.getByRole("row", { name: /Slovenija → Hrvatska/ })).toContainText("nema podataka");
  await expect(bar.getByText("Bez burze: Bosna i Hercegovina, Crna Gora.")).toBeVisible();
});

test("the hour can be changed with the keyboard and is kept in the link", async ({ page }) => {
  const all = await hours(page);
  // an older link without the offset still opens the right hour
  await openLive(page, `&lt=${all[10]?.slice(0, 13) ?? ""}`);
  const slider = page.getByRole("slider", { name: "Sat" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  // links carry the local hour and its UTC offset ("…T13+02"), encoded in the query
  const next = all[11] ?? "";
  const key = `${next.slice(0, 13)}${next.slice(-6, -3)}`;
  await expect(page).toHaveURL(new RegExp(`lt=${encodeURIComponent(key)}(&|$)`));
  await page.reload();
  await expect(page.getByRole("slider", { name: "Sat" })).toHaveValue("11");
});

test("unpublished live data is explained", async ({ page }) => {
  await page.route("**/local-data/live/current.json*", (route) => route.fulfill({ status: 404, body: "" }));
  await openLive(page);
  await expect(page.getByText("Tokovi i cijene još nisu objavljeni.")).toBeVisible();
  await expect(page.locator("[data-live-label]")).toHaveCount(0);
});

test("live layer snapshot", async ({ page }, testInfo) => {
  await openLive(page, "&v=45.0000,15.5000,5.30");
  await page.waitForTimeout(600);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-live.png`) });
});

test("flow direction is animated, unless the visitor prefers reduced motion", async ({ page }) => {
  await openLive(page);
  const map = page.locator("[data-map-status]");
  await expect(map).toHaveAttribute("data-flow-animation", "running");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(map).toHaveAttribute("data-flow-animation", "reduced");

  // off with the layer: nothing is left running
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(map).not.toHaveAttribute("data-flow-animation", /./);
});

test("the bars fold away to free the map and come back", async ({ page }) => {
  await openLive(page);
  const bar = page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" });
  await page.getByRole("button", { name: "Sakrij kartice" }).click();
  await expect(bar).toBeHidden();
  await expect(page).toHaveURL(/live=1/); // folded, not switched off
  await page.getByRole("button", { name: "Pokaži kartice" }).click();
  await expect(bar).toBeVisible();
});
