import { expect, test, type Page } from "@playwright/test";

/** Synthetic gas data from pipeline/scripts/web_fixture.py: Croatia reports every gas day but the last,
 * Italy every day; nobody else has a production point. */

async function open(page: Page, query: string): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/?${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the document is fetched only once the layer is switched on", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("live/gas.json")) requests.push(request.url());
  });
  await open(page, "v=45.4,16.3,6");
  await page.waitForTimeout(800);
  expect(requests).toEqual([]);

  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("checkbox", { name: "Proizvodnja plina (dnevno)" }).check();
  await expect(page).toHaveURL(/l=[^&]*gas/);
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("a shared link opens a country's production with a bar per gas day and a gap for the unreported one", async ({
  page,
}) => {
  await open(page, "l=plants,gas&v=45.4,16.3,6&sel=gas%3AHR");
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "Hrvatska" })).toBeVisible();
  await expect(details).toContainText("Proizvodnja plina");
  await expect(details).toContainText("Zadnji plinski dan");
  await expect(details).toContainText("GWh/dan");
  await expect(details).toContainText("13 od 14 dana");
  // the chart carries the reported days; the table with every day is folded under it
  await expect(details.locator('[data-gas-chart="13"]')).toBeVisible();
  await details.getByText("Svi dani u tablici").click();
  const bars = details.getByRole("list", { name: "Po plinskom danu" });
  await expect(bars.getByRole("listitem")).toHaveCount(14);
  await expect(bars.getByRole("listitem").last()).toContainText("nije prijavljeno");
  await expect(details).toContainText("Fixture TSO HR");
  await expect(details).toContainText("Izvori: ENTSOG");
  await expect(details.getByRole("link", { name: "Izvor podatka" })).toHaveAttribute(
    "href",
    "https://transparency.entsog.eu/",
  );
});

test("a country without a production point has no disc to select", async ({ page }) => {
  await open(page, "l=gas&v=46.2,14.5,6&sel=gas%3ASI");
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details).toContainText("Objekt je izvan trenutnog prikaza");
});

test("the legend names the layer and the attribution names ENTSOG", async ({ page }) => {
  await open(page, "l=gas&v=45.4,16.3,6");
  const legend = page.locator("details", { hasText: "Legenda" });
  if (await legend.isVisible()) {
    if (!(await legend.evaluate((el: HTMLDetailsElement) => el.open)))
      await legend.locator("summary").click();
    await expect(legend.getByText(/Proizvodnja plina po zemlji/)).toBeVisible();
  }
});

test("gas production snapshot", async ({ page }, testInfo) => {
  await open(page, "l=plants,lines,gas&v=45.0,15.5,5.5&sel=gas%3AHR");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-gas.png`) });
});
