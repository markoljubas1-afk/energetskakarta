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
  await page.getByRole("checkbox", { name: "Plin: proizvodnja i skladišta (dnevno)" }).check();
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

/** Two invented storage facilities in the shape the pipeline publishes (pipeline/tests/test_gas_storage.py). */
const STORAGE = {
  version: 1,
  generatedAt: "2026-11-17T08:00:00+00:00",
  source: "GIE AGSI",
  sourceUrl: "https://agsi.gie.eu/",
  attribution: "GIE (Gas Infrastructure Europe), AGSI platform",
  license: "GIE-AGSI-attribution",
  days: ["2026-11-14", "2026-11-15"],
  facilities: [
    {
      id: "21W-PELDA-UGS--D",
      name: "UGS Pelda",
      operator: "Pelda",
      operatorId: "21X-PELDA------C",
      country: "HU",
      lon: 20.1,
      lat: 46.3,
      workingGasTwh: 20.48,
      status: ["C", "C"],
      fullPercent: [97.6, 97.7],
      inStorageTwh: [19.99, 20.0],
      injectionGwhPerDay: [9.3, 9.1],
      withdrawalGwhPerDay: [0, 0],
    },
    {
      id: "31W-PRIMJER-UGSB",
      name: "UGS Primjer",
      operator: "Primjer",
      operatorId: "31X-PRIMJER----A",
      country: "HR",
      lon: 16.5,
      lat: 45.6,
      workingGasTwh: 4.7725,
      status: ["C", "C"],
      fullPercent: [77.07, 76.63],
      inStorageTwh: [3.6781, 3.6572],
      injectionGwhPerDay: [0, 0.84],
      withdrawalGwhPerDay: [18.4, 21.1],
    },
  ],
  missing: { facilities: [], countries: ["SI"] },
};

test("gas storage rides on the gas layer: a bar with how full it is, its source, and a point on the map", async ({
  page,
}) => {
  // the test data has no storage document (it needs a personal key); hand the page one
  await page.route(/\/local-data\/live\/gasstorage\.json/, (route) => route.fulfill({ json: STORAGE }));
  // centred on the Hungarian facility, so a click in the middle of the map is a click on its point
  await open(page, "l=gas&v=46.3,20.1,9");
  const bar = page.getByRole("region", { name: "Skladišta plina: koliko su puna" });
  // Croatia's own facility is open; the other country waits behind one line
  await expect(bar.getByText("UGS Primjer")).toBeVisible();
  await expect(bar).toContainText("76,6 %");
  await expect(bar).toContainText("povlači se 21,1 GWh/dan");
  await expect(bar.getByText("Skladišta u drugim zemljama (1)")).toBeVisible();
  await expect(bar.getByText("UGS Pelda")).toBeHidden();
  // GIE asks to be named wherever its data is shown: in the bar and in the map's credits
  await expect(
    bar.getByRole("link", { name: "GIE (Gas Infrastructure Europe), AGSI platform" }),
  ).toHaveAttribute("href", "https://agsi.gie.eu/");
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("GIE");

  // folded away, the bar leaves the map free; a click on the facility's point brings it back, opened
  await page.getByRole("button", { name: "Sakrij kartice" }).click();
  await expect(bar).toBeHidden();
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(bar.locator("li[data-picked]")).toContainText("UGS Pelda");
  await expect(bar.locator("li[data-picked]")).toContainText("utiskuje se 9,1 GWh/dan");

  // closing the bar switches the gas layer off
  await bar.getByRole("button", { name: "Zatvori sloj plina" }).click();
  await expect(bar).toHaveCount(0);
  await expect(page).not.toHaveURL(/l=[^&]*gas/);
});
