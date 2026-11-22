import { expect, test, type Page } from "@playwright/test";

/*
 * The comparisons page (Faza 49). Synthetic energy data from pipeline/scripts/web_fixture.py: HR 2024–2025
 * (12 days missing in March 2025), SI only from 2025; no monthly prices.
 */

async function openCompare(page: Page, query = ""): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/?p=compare${query}`);
  await expect(page.getByRole("heading", { name: "Usporedbe: mjeseci, godine, zemlje" })).toBeVisible();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("a month across the years: the choice goes into the link, and a month reported in part says so", async ({
  page,
}) => {
  await openCompare(page);
  const card = page.getByRole("region", { name: "Jedan mjesec kroz godine" });
  await expect(card.getByRole("img", { name: /Složeni stupci proizvodnje po izvoru za/ })).toBeVisible();
  await card.getByRole("combobox").selectOption({ label: "ožujak" });
  await expect(page).toHaveURL(/[?&]cm=3(&|$)/);
  await expect(card.getByRole("row", { name: /^2025 nepotpuno/ })).toBeVisible();
  await expect(card.getByRole("row", { name: /^2024 / })).toBeVisible();

  // the same link opens the same comparison
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Jedan mjesec kroz godine" }).getByRole("combobox"),
  ).toHaveValue("3");
});

test("year against year compares the same months, and the countries stand side by side", async ({ page }) => {
  await openCompare(page);
  const years = page.getByRole("region", { name: "Godina prema godini" });
  await expect(years.getByRole("combobox").first()).toHaveValue("2024");
  await expect(years.getByRole("combobox").last()).toHaveValue("2025");
  // March 2025 was reported in part, so March is left out of both years
  await expect(
    years.getByText(
      /Uspoređuju se samo mjeseci potpuno objavljeni u obje godine: svi mjeseci osim: ožujak\./,
    ),
  ).toBeVisible();
  await expect(years.getByRole("row", { name: /^Ukupna proizvodnja/ })).toBeVisible();

  const countries = page.getByRole("region", { name: "Zemlje usporedno" });
  await expect(countries.getByRole("row", { name: /^Hrvatska/ })).toBeVisible();
  await expect(countries.getByRole("row", { name: /^Slovenija/ })).toBeVisible();
  await expect(countries.getByText(/CO₂ je izračun/)).toBeVisible();
  await countries.getByRole("button", { name: "Godina" }).click();
  await expect(page).toHaveURL(/[?&]cu=year/);
  // the test data has no year complete for two countries (Slovenia from 2025, Croatia missing days in
  // March 2025): nothing is put side by side, and there is no empty list to choose from
  await expect(
    countries.getByText("Za to razdoblje nema potpunih podataka ni za dvije zemlje."),
  ).toBeVisible();
  await expect(countries.getByRole("combobox")).toHaveCount(0);
  await countries.getByRole("button", { name: "Mjesec" }).click();
  await expect(countries.getByRole("combobox")).toHaveValue("2025-12");
});

test("every comparison is passed on as a link, a citation, a CSV and a picture", async ({ page }) => {
  await openCompare(page, "&cm=6");
  const card = page.getByRole("region", { name: "Jedan mjesec kroz godine" });
  await expect(card.getByRole("img", { name: /Složeni stupci/ })).toBeVisible();
  await card.getByText("Podijeli").click();
  await card.getByRole("button", { name: "Citiraj" }).click();
  await expect(card.getByText(/^Izvor: GridAtlas \(.+\), prema podacima ENTSO-E/)).toBeVisible();
  const csv = page.waitForEvent("download");
  await card.getByRole("button", { name: "Preuzmi podatke (CSV)" }).click();
  expect((await csv).suggestedFilename()).toMatch(/^jedan-mjesec-kroz-godine-.*\.csv$/);
  const png = page.waitForEvent("download");
  await card.getByRole("button", { name: "Spremi sliku (PNG)" }).click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
});

test("the reports lead to the comparisons, the list and each month", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/izvjestaji/");
  await page.getByRole("link", { name: "Otvori usporedbe" }).click();
  await expect(page).toHaveURL(/\/\?p=compare$/);
  await expect(page.getByRole("heading", { name: "Usporedbe: mjeseci, godine, zemlje" })).toBeVisible();

  await page.goto("/izvjestaji/2025-10/");
  await page.getByRole("link", { name: "Otvori usporedbe" }).click();
  await expect(page).toHaveURL(/\/\?p=compare&cm=10&cp=2025-10$/);
  await expect(
    page.getByRole("region", { name: "Jedan mjesec kroz godine" }).getByRole("combobox"),
  ).toHaveValue("10");
  await expect(page.getByRole("region", { name: "Zemlje usporedno" }).getByRole("combobox")).toHaveValue(
    "2025-10",
  );
});

test("the page fits the screen", async ({ page }, testInfo) => {
  await openCompare(page);
  await expect(page.getByRole("region", { name: "Zemlje usporedno" }).getByRole("img")).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wide).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-compare.png`),
    fullPage: true,
  });
});
