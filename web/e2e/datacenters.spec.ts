import { expect, test, type Page } from "@playwright/test";

/** Data centres in the fixture (pipeline/tests/fixtures): node 70 "DC Primjer" at 15.95,45.78 from OSM,
 * completed by the hand-kept entry that adds 2.5 MW and its source; node 71 "DC Planirani" is planned;
 * "DC Ručni Primjer" at 15.55,45.49 comes only from the hand-kept list. All of it is invented test data. */
const OSM_CENTRE = "osm:node/70";
const MANUAL_CENTRE = "dc:rucni-primjer-karlovac";

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

test("a data centre completed by the hand-kept list shows its power and where it came from", async ({
  page,
}) => {
  await open(page, `v=45.78,15.95,11&sel=${encodeURIComponent(OSM_CENTRE)}`);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "DC Primjer" })).toBeVisible();
  await expect(details).toContainText("Podatkovni centar");
  await expect(details).toContainText("2,5 MW");
  // both sources are named, and the hand-kept claim links to the page it was taken from
  await expect(details.getByText(/Izvori:.*ručni popis/)).toBeVisible();
  await expect(details.getByRole("link", { name: /Izvor podatka/ })).toHaveAttribute(
    "href",
    "https://primjer.invalid/o-nama",
  );
  await expect(details.getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();
});

test("a centre known only to the hand-kept list is a record of its own", async ({ page }) => {
  await open(page, `v=45.49,15.55,11&sel=${encodeURIComponent(MANUAL_CENTRE)}`);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "DC Ručni Primjer" })).toBeVisible();
  await expect(details).toContainText("Planirano");
  // no published power is stated as exactly that, never as a number
  await expect(details).toContainText("Nije javno objavljena");
  await expect(details.getByRole("link", { name: /OpenStreetMap/ })).toHaveCount(0);
});

test("data centres are searchable and picking one switches its layer on", async ({ page }) => {
  await open(page, "l=lines&v=45.60,15.90,8");
  await page.getByRole("combobox", { name: "Pretraga" }).fill("rucni");
  await page.getByRole("option", { name: /DC Ručni Primjer/ }).click();
  await expect(page).toHaveURL(new RegExp(`sel=${encodeURIComponent(MANUAL_CENTRE)}`));
  await expect(page).toHaveURL(/l=lines%2Cdatacenters/);
  await expect(page.getByRole("heading", { name: "DC Ručni Primjer" })).toBeVisible();
});

test("the layer can be switched off, and says plainly that it is incomplete", async ({ page }) => {
  // the map opens on the lines alone; the link switches the layer on
  await open(page, "l=lines,datacenters&v=45.78,15.95,11");
  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  const checkbox = page.getByRole("checkbox", { name: "Podatkovni centri" });
  await expect(checkbox).toBeChecked();
  // the note waits behind the "i" beside the switch
  await page.getByRole("button", { name: "O sloju: Podatkovni centri" }).click();
  await expect(page.getByText(/Popis nije potpun/)).toBeVisible();

  await checkbox.uncheck();
  await expect(page).not.toHaveURL(/datacenters/);
  // the hidden layer must have left the rendered style before a click can prove it is gone
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await page.keyboard.press("Escape");
  if (await page.getByRole("button", { name: "Sakrij filtre i pregled" }).isVisible()) {
    await page.getByRole("button", { name: "Sakrij filtre i pregled" }).click();
  }
  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).not.toHaveURL(/sel=/);
});

test("the data centre file is offered for download", async ({ page }) => {
  await open(page, "v=45.78,15.95,11");
  await page.getByRole("button", { name: "Preuzmi bazu", exact: true }).click();
  await expect(page.getByRole("link", { name: "Podatkovni centri" })).toBeVisible();
});

test("data centre snapshot", async ({ page }, testInfo) => {
  await open(page, `v=45.78,15.95,11&sel=${encodeURIComponent(OSM_CENTRE)}`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-datacenters.png`) });
});
