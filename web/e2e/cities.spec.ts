import { expect, test, type Page } from "@playwright/test";

/**
 * Invented Covenant of Mayors release (pipeline/scripts/cities_fixture.py): Grad Primjer (HR, 2019
 * monitoring inventory over a 2011 baseline) and Mesto Vzorec (SI); the Italian city is outside the
 * fixture's borders and the German one outside the region.
 */
const GRAD = { id: "com:1001", lon: 16.0, lat: 45.5 };

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

test("the layer is off by default, switches on from the list and shows a city's inventory", async ({
  page,
}) => {
  await openMap(page, `?v=${GRAD.lat},${GRAD.lon},9`);
  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  const box = page.getByRole("checkbox", { name: "Gradovi: potrošnja energije" });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(page).toHaveURL(/l=[^&]*cities/);
  await page.keyboard.press("Escape");
  const close = page.getByRole("button", { name: "Sakrij filtre i pregled" });
  if (await close.isVisible()) {
    await close.click();
    // the sheet slides away over 200 ms; a click during that would land on the sheet
    await expect(page.locator("#settings-panel")).toBeHidden();
  }
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();

  const canvas = page.locator("canvas.maplibregl-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("map canvas has no size");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page).toHaveURL(new RegExp(`sel=${encodeURIComponent(GRAD.id)}`));
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "Grad Primjer" })).toBeVisible();
  await expect(details.getByText("2019")).toBeVisible();
  await expect(details.getByText("186.500 MWh/god")).toBeVisible();
  const bars = details.getByRole("list", { name: "Struja po namjeni" });
  await expect(bars.getByText("Javna rasvjeta")).toBeVisible();
  await expect(bars.getByText("6.500 MWh/god")).toBeVisible();
  // the fall since the 2011 baseline: 186 500 against 175 000 is a rise of 6,6 %
  await expect(details.getByText(/U odnosu na 2011: \+6,6/)).toBeVisible();
  await expect(details.getByText(/Izvori: Sporazum gradonačelnika/)).toBeVisible();
});

test("a city is searchable and the legend explains the discs", async ({ page }) => {
  await openMap(page);
  await page.getByRole("combobox", { name: "Pretraga" }).fill("vzorec");
  await page.getByRole("option", { name: /Mesto Vzorec/ }).click();
  await expect(page).toHaveURL(/sel=com%3A1002/);
  await expect(page).toHaveURL(/l=[^&]*cities/);
  await expect(page.getByRole("heading", { name: "Mesto Vzorec" })).toBeVisible();
  const legend = page.locator("details", { hasText: "Legenda" });
  if (await legend.isVisible()) {
    if (!(await legend.evaluate((el: HTMLDetailsElement) => el.open)))
      await legend.locator("summary").click();
    await expect(legend.getByText(/Grad s inventarom/)).toBeVisible();
  }
});

test("the register page lists cities by country with lighting and transport columns", async ({ page }) => {
  await page.goto("/gradovi/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Registar gradova/);
  const hr = page
    .getByRole("region", { name: /Hrvatska/ })
    .or(page.locator("section", { hasText: "Hrvatska (1)" }));
  await expect(hr.first()).toBeVisible();
  const row = page.getByRole("row", { name: /Grad Primjer/ });
  await expect(row).toContainText("2019");
  await expect(row).toContainText("186.500");
  await expect(row).toContainText("6.500"); // public lighting
  await expect(row).toContainText("9.000"); // public transport
  // the large city has its own page with the sector table
  await row.getByRole("link", { name: "Grad Primjer" }).click();
  await expect(page).toHaveURL(/\/objekt\/com-1001\/$/);
  await expect(page.getByRole("rowheader", { name: "Javna rasvjeta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Prikaži na karti" })).toHaveAttribute(
    "href",
    /sel=com%3A1001/,
  );
});
