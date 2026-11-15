import { expect, test, type Page } from "@playwright/test";

/**
 * The fixture's change report (pipeline/scripts/web_fixture.py, write_fixture_diff) compares the build
 * with an imagined previous one: one plant is new, one plant changed, one line was removed.
 */

async function openChanges(page: Page): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/?panel=changes");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.getByRole("tab", { name: "Novo" })).toHaveAttribute("aria-selected", "true");
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the tab lists what changed since the previous release, by layer and country", async ({ page }) => {
  await openChanges(page);
  await expect(page.getByRole("heading", { name: "Promjene od prošle objave" })).toBeVisible();
  await expect(page.getByText(/Uspoređeno s podacima od 1\. rujna 2026\./)).toBeVisible();
  const plants = page.getByRole("region", { name: "Elektrane" });
  await expect(plants.getByText("5 bez promjene")).toBeVisible();
  // the changed plant is GEM's record, so it has no OpenStreetMap link; the new one is an OSM-free wind farm
  await expect(plants.getByText("RHE Primjer")).toBeVisible();
  await expect(plants.getByText("VE More")).toBeVisible();
  const lines = page.getByRole("region", { name: "Dalekovodi i kabeli" });
  await expect(lines.getByText("Ukinuti vod (testni)")).toBeVisible();
});

test("an example flies the map there and selects it", async ({ page }) => {
  await openChanges(page);
  const plants = page.getByRole("region", { name: "Elektrane" });
  await plants.getByRole("button", { name: "Prikaži na karti: VE More" }).click();
  await expect(page).toHaveURL(/sel=emodnet%3Awindfarms%2F2/);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "VE More" })).toBeVisible();
  // the view moved to the example
  await expect(page).toHaveURL(/v=44\.5\d*%2C14\.0\d*/);
});

test("the tab is only offered when the build publishes a report", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.route("**/current.json*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    delete body.diff;
    await route.fulfill({ response, json: body });
  });
  await page.goto("/?panel=changes");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.getByRole("tab", { name: "Novo" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Filtri" })).toHaveAttribute("aria-selected", "true");
});
