import { expect, test } from "@playwright/test";

/** Faza 18: the time machine and the price colours, on the fixture build (pipeline/scripts/web_fixture.py). */

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
});

test("the time machine opens from the filters, keeps its year in the link and closes", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("button", { name: "Otvori vremeplov" }).click();
  await expect(page).toHaveURL(/[?&]y=\d{4}/);
  const hide = page.getByRole("button", { name: "Sakrij filtre i pregled" });
  if (await hide.isVisible()) await hide.click();
  const bar = page.getByRole("region", { name: "Vremeplov elektrana" });
  await expect(bar.getByText(/^U pogonu \d{4}\.:/)).toBeVisible();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await bar.getByRole("button", { name: "Zatvori vremeplov" }).click();
  await expect(page).not.toHaveURL(/[?&]y=/);
  await expect(bar).toHaveCount(0);
});

test("the live bar explains the price colours on the map", async ({ page }) => {
  await page.goto("/?live=1");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const bar = page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" });
  await expect(bar.getByText("Boja zemlje: cijena u satu (€/MWh)")).toBeVisible();
  await expect(bar.getByRole("button", { name: "Pusti dan" })).toBeVisible();
});

test("the live bar says what the grid's electricity is made of", async ({ page }) => {
  await page.goto("/?live=1");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const mix = page.getByRole("region", { name: "Od čega je struja u mreži" });
  await expect(mix.getByText(/Struja se u mreži miješa/)).toBeVisible();
  await expect(mix.getByText(/^Ukupno u tom satu:/)).toBeVisible();
  await mix.getByRole("button", { name: "Kod mene" }).click();
  await expect(mix.getByRole("button", { name: "Koristi moju lokaciju" })).toBeVisible();
});
