import { expect, test, type Page } from "@playwright/test";

/**
 * The solar potential layer. The test data has no atlas (it is a separate, manual publication), so the page is
 * handed a small one: two cells of 5 degrees over the region, and a one-pixel picture.
 */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const SOLAR = {
  version: 1,
  generatedAt: "2026-11-16T20:00:00+00:00",
  source: "Global Solar Atlas 2.0",
  license: "CC-BY-4.0",
  attribution: "Global Solar Atlas 2.0 (World Bank / ESMAP), solar resource data © 2019 Solargis, CC BY 4.0",
  unit: "kWh/kWp per year",
  countries: ["Croatia"],
  bounds: [12, 42, 22, 47],
  min: 1250,
  max: 1300,
  ramp: [
    [900, "#2c1a5c"],
    [1750, "#fcf0a4"],
  ],
  grid: { west: 12, north: 47, cellDeg: 5, cols: 2, rows: 1, values: [1250, 1300] },
  image: "solar/pvout-0123456789abcdef.png",
};

async function open(page: Page): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.route("**/local-data/solar/index.json", (route) => route.fulfill({ json: SOLAR }));
  await page.route("**/local-data/solar/pvout-*.png", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
  // open water west of Istria: nothing there to select, so the click is the layer's own
  await page.goto("/?l=solar&v=44.9,13.2,9");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("a click on the map reads the expected yearly output there, with the caveat and the source", async ({
  page,
}) => {
  await open(page);
  const bar = page.getByRole("region", { name: "Sunčani potencijal" });
  await expect(bar.getByText(/Kliknite bilo gdje na karti/)).toBeVisible();
  await expect(bar.getByText(/ne studija izvedivosti/)).toBeVisible();
  await expect(bar.getByText(/© 2019 Solargis, CC BY 4.0/)).toBeVisible();

  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await expect(bar.getByText("1.250", { exact: true })).toBeVisible();
  // how many panels a year's consumption would take at this very place: 4,000 kWh at 1,250 kWh/kWp
  await expect(bar.getByRole("slider", { name: /Vaša godišnja potrošnja struje/ })).toHaveValue("4000");
  await expect(bar).toContainText("Ovdje za to treba oko 3,2 kWp, otprilike 8 panela od 430 W.");
  await bar.getByRole("slider", { name: /Vaša godišnja potrošnja struje/ }).fill("10000");
  await expect(bar).toContainText("Ovdje za to treba oko 8 kWp, otprilike 19 panela od 430 W.");
  await expect(bar.getByRole("link", { name: "PVGIS" })).toHaveAttribute(
    "href",
    "https://re.jrc.ec.europa.eu/pvg_tools/en/",
  );

  // closing the bar switches the layer off
  await bar.getByRole("button", { name: "Zatvori sunčani potencijal" }).click();
  await expect(bar).toHaveCount(0);
  await expect(page).not.toHaveURL(/solar/);
});

test("the bar folds away and a click on the map brings it back with the reading", async ({ page }) => {
  await open(page);
  const bar = page.getByRole("region", { name: "Sunčani potencijal" });
  await page.getByRole("button", { name: "Sakrij kartice" }).click();
  await expect(bar).toBeHidden();
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await expect(bar.getByText("1.250", { exact: true })).toBeVisible();
});
