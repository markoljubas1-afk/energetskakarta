import { expect, test, type Page } from "@playwright/test";

/** Fixture sites: a gas well (node 80) and an open-pit lignite mine (way 112), both named. */
const WELL = "osm:node/80";
const PIT = "osm:way/112";

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

test("the archive is left alone until the layer is switched on", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("extraction.pmtiles")) requests.push(request.url());
  });
  await open(page, "v=45.55,16.90,10");
  await page.waitForTimeout(1000);
  expect(requests).toEqual([]);

  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("checkbox", { name: "Crpilišta i rudnici" }).check();
  await expect(page).toHaveURL(/extraction/);
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("a shared link opens a well with its substance and says there are no production figures", async ({
  page,
}) => {
  await open(page, `l=extraction&v=45.55,16.90,12&sel=${encodeURIComponent(WELL)}`);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "Bušotina Primjer" })).toBeVisible();
  await expect(details).toContainText("Bušotina (nafta/plin)");
  await expect(details).toContainText("Sirovina");
  await expect(details).toContainText("Plin");
  await expect(details).toContainText("Nafta d.d.");
  await expect(details).toContainText("Podataka o proizvodnji nema");
  await expect(details.getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();
  // the selection ring swells twice and settles; the map notes when it is done
  await expect(page.locator('[data-selection-pulse="done"], [data-selection-pulse="reduced"]')).toBeVisible({
    timeout: 10_000,
  });
});

test("an open-pit mine mapped as a quarry area is a point with its resource", async ({ page }) => {
  await open(page, `l=extraction&v=45.215,15.22,12&sel=${encodeURIComponent(PIT)}`);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "Površinski kop" })).toBeVisible();
  await expect(details).toContainText("Lignit");
});

test("named sites are searchable and picking one switches the layer on", async ({ page }) => {
  await open(page, "v=45.70,15.85,8");
  await page.getByRole("combobox", { name: "Pretraga" }).fill("busotina");
  const option = page.getByRole("option", { name: /Bušotina Primjer/ });
  await expect(option).toContainText("Plin");
  await option.click();
  await expect(page).toHaveURL(/extraction/);
  await expect(page).toHaveURL(/sel=osm%3Anode%2F80/);
});

test("the legend explains the colours once the layer is on", async ({ page }) => {
  await open(page, "l=extraction&v=45.55,16.90,10");
  const legend = page.locator("details", { hasText: "Legenda" });
  if (await legend.isVisible()) {
    // getAttribute("open") is "" (falsy) on an open element, so ask the element itself
    if (!(await legend.evaluate((el: HTMLDetailsElement) => el.open)))
      await legend.locator("summary").click();
    await expect(legend.getByText("Nafta i plin")).toBeVisible();
    await expect(legend.getByText(/Bez podataka o proizvodnji/)).toBeVisible();
  }
});

test("extraction snapshot", async ({ page }, testInfo) => {
  await open(page, `l=extraction,plants&v=45.55,16.90,11&sel=${encodeURIComponent(WELL)}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-extraction.png`) });
});
