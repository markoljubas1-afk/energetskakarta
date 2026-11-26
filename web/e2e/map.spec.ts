import { expect, test, type Page } from "@playwright/test";

/** Assets from the pipeline fixture (pipeline/tests/fixtures/sample.osm). */
const RHE = { id: "osm:way/109", lon: 16.51, lat: 45.81 };
const TS = { id: "osm:node/50", lon: 15.95, lat: 45.55 };

const view = (lat: number, lon: number, zoom: number): string => `v=${lat},${lon},${zoom}`;

async function openMap(page: Page, query = ""): Promise<void> {
  // MapTiler is not configured in tests; any request to it would be a bug.
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("loads real tiles on the fallback basemap without errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await openMap(page);
  await expect(page.locator("[data-basemap]")).toHaveAttribute("data-basemap", "fallback");
  await expect(page.locator("[data-data-version]")).toContainText("Karta od");
  // no MapTiler key configured: no fallback warning either
  await expect(page.getByText(/Detaljna podloga nije dostupna/)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("search finds an asset, flies there and shows its details", async ({ page }) => {
  await openMap(page);
  const search = page.getByRole("combobox", { name: "Pretraga" });
  await search.fill("rhe");
  // two results share the name: the operating plant (276 MW) and GEM's announced expansion (150 MW)
  await expect(page.getByRole("option", { name: /RHE Primjer/ })).toHaveCount(2);
  await page.getByRole("option", { name: /RHE Primjer.*276 MW/ }).click();
  await expect(page).toHaveURL(new RegExp(`sel=${encodeURIComponent(RHE.id)}`));
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "RHE Primjer" })).toBeVisible();
  await expect(details.getByText("276 MW")).toBeVisible();
  await expect(details.getByRole("link", { name: /OpenStreetMap/ })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/way/109",
  );
  // merged record: capacity and operator come from Global Energy Monitor
  await expect(details.getByText("HEP Proizvodnja")).toBeVisible();
  await expect(details.getByText(/Izvori: .*Global Energy Monitor.*OpenStreetMap/)).toBeVisible();
  await expect(details.getByRole("link", { name: /GEM wikiju/ })).toHaveAttribute(
    "href",
    "https://www.gem.wiki/RHE_Primjer",
  );
});

test("Back returns to the previous object, then closes the details, before it leaves the map", async ({
  page,
}) => {
  await openMap(page);
  const search = page.getByRole("combobox", { name: "Pretraga" });
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await search.fill("rhe");
  await page.getByRole("option", { name: /RHE Primjer.*276 MW/ }).click();
  await expect(details.getByRole("heading", { name: "RHE Primjer" })).toBeVisible();
  await search.fill("daleko");
  await page.getByRole("option", { name: /Vjetroelektrana Daleko/ }).click();
  await expect(details.getByRole("heading", { name: "Vjetroelektrana Daleko" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`sel=${encodeURIComponent(RHE.id)}`));
  await expect(details.getByRole("heading", { name: "RHE Primjer" })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/sel=/);
  await expect(page.getByRole("heading", { name: "RHE Primjer" })).toHaveCount(0);
  // still on the map: the flights and pans in between added no steps of their own
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
});

test("a plant known only to Global Energy Monitor is searchable, shareable and credited", async ({
  page,
}) => {
  await openMap(page);
  await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toContainText(
    "Global Energy Monitor (CC BY 4.0)",
  );
  await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toContainText("TransitionZero");
  await page.getByRole("combobox", { name: "Pretraga" }).fill("daleko");
  await page.getByRole("option", { name: /Vjetroelektrana Daleko/ }).click();
  await expect(page).toHaveURL(/sel=gem%3AL100000000004%3Aoperating/);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "Vjetroelektrana Daleko" })).toBeVisible();
  await expect(details.getByText("1,2 GW")).toBeVisible();
  await expect(details.getByText("Izvori: Global Energy Monitor")).toBeVisible();
  await expect(details.getByRole("link", { name: /OpenStreetMap/ })).toHaveCount(0);

  // the link alone restores the selection
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(details.getByRole("heading", { name: "Vjetroelektrana Daleko" })).toBeVisible();
});

test("clicking an asset on the map selects it; hiding its layer makes it unclickable", async ({ page }) => {
  await openMap(page, `?l=lines,substations,plants&${view(RHE.lat, RHE.lon, 12)}`);
  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.click(center.x, center.y);
  await expect(page.getByRole("heading", { name: "RHE Primjer" })).toBeVisible();
  await page.getByRole("button", { name: "Zatvori detalje" }).click();
  await expect(page).not.toHaveURL(/sel=/);

  await openSettings(page);
  await page.getByRole("checkbox", { name: /Elektrane/ }).uncheck();
  await expect(page).toHaveURL(/l=lines%2Csubstations/);
  await page.keyboard.press("Escape");
  const toggle = page.getByRole("button", { name: "Sakrij filtre i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await page.mouse.click(center.x, center.y);
  await expect(page).not.toHaveURL(/sel=/);
  await expect(page.getByRole("heading", { name: "RHE Primjer" })).toHaveCount(0);
});

test("resting the pointer on an asset shows a tooltip and highlights it; leaving clears both", async ({
  page,
}) => {
  await openMap(page, `?l=lines,plants&${view(RHE.lat, RHE.lon, 12)}`);
  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const tooltip = page.locator("[data-map-tooltip]");

  await page.mouse.move(center.x, center.y);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("RHE Primjer");
  await expect(tooltip).toContainText("276 MW");
  // the highlight itself is map feature state; the map publishes the hovered id for tests and tools
  await expect(page.locator("[data-map-status]")).toHaveAttribute("data-hovered", RHE.id);
  // the tooltip never sits under the pointer
  const tip = await tooltip.boundingBox();
  expect(tip && (tip.x > center.x || tip.y > center.y || tip.x + tip.width < center.x)).toBe(true);

  await page.mouse.move(box.x + 4, box.y + 4);
  await expect(tooltip).toBeHidden();
  await expect(page.locator("[data-map-status]")).not.toHaveAttribute("data-hovered", /./);
});

test("a shared link restores view, filters and selection", async ({ page }) => {
  await openMap(
    page,
    `?${view(TS.lat, TS.lon, 10)}&kv=380%2B&sel=${encodeURIComponent(TS.id)}&panel=filters`,
  );
  await expect(page.getByRole("heading", { name: "TS Žerjavinec" })).toBeVisible();
  await expect(page.getByText("400 / 110 kV")).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole("button", { name: "380 kV i više" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "220–379 kV" })).toHaveAttribute("aria-pressed", "false");
});

test("overview shows installed capacity from stats.json", async ({ page }) => {
  await openMap(page, "?panel=overview");
  await openSettings(page);
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("Ukupno u pogonu")).toBeVisible();
  await panel.getByRole("combobox", { name: "Područje" }).selectOption("HR");
  await expect(panel.getByText("Reverzibilna hidro")).toBeVisible();
  await expect(panel.getByText(/Prema OpenStreetMapu/)).toBeVisible();
});

test("switches to English and keeps it on reload", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("combobox", { name: "Search" })).toBeVisible();
  // the language is the path: /en/ (todo 16-A3)
  await expect(page).toHaveURL(/\/en\/(\?.*)?$/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("[data-data-version]")).toContainText("Map as of");
});

test("the map opens dark, and a switch to the light theme is remembered", async ({ page }) => {
  await openMap(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Promijeni svijetlu ili tamnu temu" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
});

test("a data outage shows a retry that recovers", async ({ page }) => {
  let fail = true;
  await page.route("**/local-data/current.json*", async (route) => {
    if (fail) await route.fulfill({ status: 503, body: "down" });
    else await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Podaci se nisu učitali" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Pokušaj ponovno" }).click();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
});

test("the page sends the security headers from _headers only on Cloudflare, but builds them", async ({
  request,
}) => {
  // vite preview does not apply _headers; the file itself must be part of the build output
  const response = await request.get("/_headers");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("Content-Security-Policy: default-src 'self'");
});

test("visual review snapshot", async ({ page }, testInfo) => {
  await openMap(page, `?${view(45.5, 15.8, 7.5)}`);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}.png`) });
});

test("single keys jump to search, open the shortcut list and toggle the live layer", async ({ page }) => {
  await openMap(page);
  await page.keyboard.press("/");
  await expect(page.getByRole("combobox", { name: "Pretraga" })).toBeFocused();
  // inside the field the key is just a character
  await page.keyboard.type("?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });

  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Tipkovnički prečaci" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Skoči u pretragu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.keyboard.press("l");
  await expect(page).toHaveURL(/live=1/);
  await page.keyboard.press("l");
  await expect(page).not.toHaveURL(/live=1/);
});
