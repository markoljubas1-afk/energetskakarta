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

/** The daily shapes behind the house: sun from 07:00 to 17:00 with its peak at noon, an evening household. */
const DAY_OF_SUN = Array.from({ length: 24 }, (_, hour) => Math.max(0, 600 - 100 * Math.abs(hour - 12)));
const DAY_OF_HOUSE = Array.from({ length: 24 }, (_, hour) => (hour >= 18 ? 200 : 90));
const HOME = {
  version: 1,
  generatedAt: "2026-11-18T20:00:00+00:00",
  timezone: "Europe/Zagreb",
  sun: {
    source: "PVGIS 5.3",
    sourceUrl: "https://re.jrc.ec.europa.eu/pvg_tools/en/",
    license: "CC-BY-4.0",
    attribution: "PVGIS © European Communities, 2001-2026",
    plane: { slopeDeg: 35, azimuthDeg: 0 },
    unit: "W/m2",
    grid: { west: 12, south: 44, step: 2, cols: 1, rows: 1 },
    points: [Array.from({ length: 12 }, () => DAY_OF_SUN)],
  },
  household: {
    source: "HEP ODS, nadomjesne krivulje opterećenja (NKO KSK), skupina kućanstvo K0",
    sourceUrl: "https://www.hep.hr/ods/",
    license: "HEP-ODS-permission",
    year: 2026,
    group: "K0",
    unit: "W per 1000 kWh/year",
    months: Array.from({ length: 12 }, () => DAY_OF_HOUSE),
  },
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

test("a link with a place opens the reading and the house there, without a click", async ({ page }) => {
  await page.route("**/local-data/solar/home.json", (route) => route.fulfill({ json: HOME }));
  await page.route("**/local-data/solar/index.json", (route) => route.fulfill({ json: SOLAR }));
  await page.route("**/local-data/solar/pvout-*.png", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
  await page.goto("/?l=lines,solar&v=45.8150,15.9819,10&sun=45.8150,15.9819");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const bar = page.getByRole("region", { name: "Sunčani potencijal" });
  await expect(bar.getByText("1.250", { exact: true })).toBeVisible();
  await expect(bar.getByRole("img", { name: /paneli daju/ })).toBeVisible();
});

test("the house under the calculator shows where the electricity goes, hour by hour, with a battery", async ({
  page,
}, testInfo) => {
  await page.route("**/local-data/solar/home.json", (route) => route.fulfill({ json: HOME }));
  await open(page);
  const bar = page.getByRole("region", { name: "Sunčani potencijal" });
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  const house = bar.getByRole("img", { name: /paneli daju/ });
  await house.scrollIntoViewIfNeeded();
  // 13:00 without a battery: the panels cover the house and the rest goes to the grid
  await expect(house).toHaveAccessibleName(
    /^U 13:00, prosječan dan, \S+: paneli daju [\d,]+ kW, kuća troši [\d,]+ kW\. U mrežu ide [\d,]+ kW\.$/,
  );
  await expect(house.locator('[data-flow="pvToGrid"]')).toHaveCount(1);
  await expect(house.locator('[data-flow="gridToHome"]')).toHaveCount(0);
  await bar.screenshot({ path: testInfo.outputPath("house-noon.png") });

  // 20:00: no sun, the grid feeds the house
  const hour = bar.getByRole("slider", { name: "Sat u danu" });
  await hour.fill("20");
  await expect(house).toHaveAccessibleName(/^U 20:00, .*paneli daju 0 kW, .*Iz mreže dolazi [\d,]+ kW\.$/);
  await expect(house.locator('[data-flow="gridToHome"]')).toHaveCount(1);
  const before = await bar.getByText(/^Kroz godinu \(izračun\)/).textContent();

  // with a battery the evening comes from it, and the year's shares rise beside the ones without it
  await bar.getByRole("checkbox", { name: "Želim i kućnu bateriju" }).check();
  await expect(house).toHaveAccessibleName(/Baterija daje kući [\d,]+ kW\.$/);
  await expect(house.locator('[data-flow="batteryToHome"]')).toHaveCount(1);
  await expect(house.locator('[data-flow="gridToHome"]')).toHaveCount(0);
  const after = bar.getByText(/^Kroz godinu \(izračun\)/);
  await expect(after).toContainText(/Bez baterije: \d+ % i \d+ %\./);
  expect(await after.textContent()).not.toBe(before);
  await expect(bar).toContainText("PVGIS © European Communities, 2001-2026");
  await expect(bar).toContainText("HEP ODS, nadomjesne krivulje opterećenja");
  await bar.screenshot({ path: testInfo.outputPath("house-evening-battery.png") });

  // the drawing stays inside the bar
  const drawing = await house.boundingBox();
  const around = await bar.boundingBox();
  if (!drawing || !around) throw new Error("no box");
  expect(drawing.x).toBeGreaterThanOrEqual(around.x);
  expect(drawing.x + drawing.width).toBeLessThanOrEqual(around.x + around.width + 0.5);
});
