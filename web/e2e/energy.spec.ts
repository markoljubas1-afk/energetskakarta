import { expect, test, type Page } from "@playwright/test";

/** Synthetic energy data from pipeline/scripts/web_fixture.py: HR 2024–2025 (12 days missing in March
 * 2025), SI only from 2025. */

async function openEnergy(page: Page, query = ""): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/?p=energy${query}`);
  await expect(page.getByRole("heading", { name: "Proizvodnja i potrošnja kroz vrijeme" })).toBeVisible();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("switching views keeps the map alive and puts the view in the link", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await page.getByRole("button", { name: /Proizvodnja kroz vrijeme/ }).click();
  await expect(page).toHaveURL(/p=energy/);
  await expect(page.getByRole("img", { name: /Složeni stupci/ })).toBeVisible();
  await page.getByRole("button", { name: /Karta/ }).click();
  await expect(page).not.toHaveURL(/p=energy/);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
});

test("the table marks incomplete months instead of showing low values", async ({ page }) => {
  await openEnergy(page, "&es=table");
  const table = page.getByRole("table").first();
  const march = table.getByRole("row", { name: /ožu 2025/ });
  await expect(march).toHaveAttribute("data-incomplete", "true");
  await expect(march).toContainText("61,3 %");
  // Slovenia reports only from 2025, so the region is incomplete for every month of 2024
  await expect(table.getByRole("row", { name: /sij 2024/ })).toHaveAttribute("data-incomplete", "true");
  await expect(table.getByRole("row", { name: /sij 2025/ })).not.toHaveAttribute("data-incomplete", "true");
});

test("a country with no data for a year shows a gap, not zero", async ({ page }) => {
  await openEnergy(page, "&ea=SI&eu=year&es=table");
  const table = page.getByRole("table").first();
  await expect(table.getByRole("row", { name: /^2024/ })).toContainText("nema podataka");
  await expect(table.getByRole("row", { name: /^2025/ })).toContainText("GWh");
});

test("totals for a range report their coverage", async ({ page }) => {
  await openEnergy(page, "&ea=HR");
  await page.getByLabel("Od", { exact: true }).fill("2025-03-01");
  await page.getByLabel("Do", { exact: true }).fill("2025-03-31");
  await page.getByRole("button", { name: "Izračunaj" }).click();
  await expect(page).toHaveURL(/er=2025-03-01%2C2025-03-31/);
  await expect(page.getByText(/Podaci za 19 od 31 dana\./)).toBeVisible();
  await expect(page.getByText(/Potrošnja nije poznata za cijelo razdoblje/)).toBeVisible();
  await expect(page.getByRole("row", { name: /^Hidro/ })).toBeVisible();

  // a shared link reproduces the result
  await page.reload();
  await expect(page.getByText(/Podaci za 19 od 31 dana\./)).toBeVisible();
});

test("a full summer gives shares of load", async ({ page }) => {
  await openEnergy(page, "&ea=HR&er=2025-06-01,2025-08-31");
  await expect(page.getByText("Podaci za 92 od 92 dana.")).toBeVisible();
  await expect(page.getByRole("row", { name: /^Ukupna proizvodnja/ })).toContainText("%");
  await expect(page.getByRole("row", { name: /^Pumpanje/ })).toBeVisible();
});

test("comparing years draws one line per year for the chosen source", async ({ page }) => {
  await openEnergy(page, "&ea=HR");
  await page.getByRole("combobox", { name: "Izvor", exact: true }).selectOption("hydro");
  await expect(page).toHaveURL(/et=hydro/);
  await expect(
    page.getByRole("img", { name: /Crte po godinama: mjesečna proizvodnja iz izvora Hidro/ }),
  ).toBeVisible();
});

test("an unpublished dataset is explained", async ({ page }) => {
  await page.route("**/local-data/energy/current.json*", (route) => route.fulfill({ status: 404, body: "" }));
  await openEnergy(page);
  await expect(page.getByText("Podaci o proizvodnji kroz vrijeme još nisu objavljeni.")).toBeVisible();
});

test("energy view snapshot", async ({ page }, testInfo) => {
  await openEnergy(page, "&ea=HR&er=2025-06-01,2025-08-31");
  await expect(page.getByText("Podaci za 92 od 92 dana.")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-energy.png`), fullPage: true });
});

test("a chart is passed on with its source: link to the card, citation, CSV and a picture (Faza 23)", async ({
  page,
}) => {
  await openEnergy(page, "&ea=HR");
  const card = page.getByRole("region", { name: "Proizvodnja po izvoru i potrošnja" });
  await expect(page.getByRole("img", { name: /Složeni stupci/ })).toBeVisible();
  await expect(card.getByText(/^Izvor: ENTSO-E Transparency Platform · stanje /)).toBeVisible();
  await card.getByText("Podijeli").click();
  await card.getByRole("button", { name: "Citiraj" }).click();
  await expect(card.getByText(/^Izvor: GridAtlas \(.+\), prema podacima ENTSO-E/)).toBeVisible();
  const csv = page.waitForEvent("download");
  await card.getByRole("button", { name: "Preuzmi podatke (CSV)" }).click();
  expect((await csv).suggestedFilename()).toMatch(
    /^proizvodnja-po-izvoru-i-potrosnja-hrvatska-po-mjesecima-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const png = page.waitForEvent("download");
  await card.getByRole("button", { name: "Spremi sliku (PNG)" }).click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
});

test("a link to a card opens the page at it, and an embedded card shows alone", async ({ page }) => {
  await openEnergy(page, "&ea=HR#range");
  await expect(page.getByRole("region", { name: "Zbroj za odabrano razdoblje" })).toBeInViewport();
  await page.goto("/?p=energy&ea=HR&embed=1&ec=compare");
  await expect(page.getByRole("img", { name: /Crte po godinama/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Složeni stupci/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Otvori cijeli prikaz/ })).toHaveAttribute("href", /#compare$/);
});
