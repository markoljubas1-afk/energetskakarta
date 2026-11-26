import { expect, test, type Locator, type Page } from "@playwright/test";

/** Floating elements must never cover one another: every pair of visible boxes is checked, in every state
 * that adds an element to the screen (live bar, its table, details panel). Found by looking at a snapshot
 * (the status bar covered the bottom of the live bar); this keeps it found. */

const PIPELINE = "emodnet:pipelines/101";

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function open(page: Page, query: string): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/?${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
}

function floating(page: Page): Record<string, Locator> {
  return {
    "live bar": page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" }),
    "data version": page.locator("[data-data-version]"),
    downloads: page.getByRole("button", { name: "Preuzmi bazu", exact: true }),
    // the scrolling frame around the legend, not its (possibly taller, clipped) content
    legend: page.locator("details", { hasText: "Legenda" }).locator(".."),
    "settings panel": page.locator("#settings-panel"),
    "settings button": page.getByRole("button", { name: "Filtri i pregled" }),
    details: page.getByRole("complementary", { name: "Detalji objekta" }),
    "zoom buttons": page.locator(".maplibregl-ctrl-top-right .maplibregl-ctrl-group"),
    scale: page.locator(".maplibregl-ctrl-scale"),
    attribution: page.locator(".maplibregl-ctrl-attrib"),
  };
}

/** Boxes of the named elements that are on screen now; `required` must be among them. */
async function visibleBoxes(page: Page, required: readonly string[]): Promise<Box[]> {
  const boxes: Box[] = [];
  for (const [name, locator] of Object.entries(floating(page))) {
    if (required.includes(name)) await expect(locator, name).toBeVisible();
    if (!(await locator.isVisible())) continue;
    const box = await locator.boundingBox();
    if (box !== null) boxes.push({ name, ...box });
  }
  return boxes;
}

function overlaps(boxes: readonly Box[]): string[] {
  const found: string[] = [];
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1)) {
      if (intersects(a, b)) found.push(`${a.name} × ${b.name}`);
    }
  });
  return found;
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the live bar, the status bar and the map controls never cover one another", async ({ page }) => {
  await open(page, "live=1");
  const required = ["live bar", "data version", "downloads", "zoom buttons", "attribution"];
  expect(overlaps(await visibleBoxes(page, required))).toEqual([]);

  // the table makes the bar taller; it has to grow away from its neighbours. Which borders it lists, and
  // in which direction, depends on the hour, so this waits for the table itself, not for a named row.
  await page.getByText("Brojke za odabrani sat").click();
  await expect(page.getByRole("table").first()).toBeVisible();
  expect(overlaps(await visibleBoxes(page, required))).toEqual([]);
});

/** On phones the details are a bottom sheet the reader opens and closes: like any sheet it may cover what
 * lies under it (live bar, scale, attribution) while open. Buttons and the status bar stay free everywhere. */
const UNDER_A_PHONE_SHEET = ["live bar", "scale", "attribution"];

test("the details panel leaves the zoom buttons and the bars free", async ({ page }, testInfo) => {
  await open(page, `live=1&v=44.7,13.85,9&sel=${encodeURIComponent(PIPELINE)}`);
  await expect(page.getByRole("heading", { name: "Plinovod Primjer" })).toBeVisible();
  const required = ["details", "zoom buttons", "data version", "downloads"];
  const boxes = await visibleBoxes(page, required);
  const underSheet = (pair: string): boolean =>
    testInfo.project.name === "mobile" &&
    UNDER_A_PHONE_SHEET.some((name) => pair === `${name} × details` || pair === `details × ${name}`);
  expect(overlaps(boxes).filter((pair) => !underSheet(pair))).toEqual([]);
});

test("a small laptop window keeps the same guarantee", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "phones have their own layout, covered above");
  await page.setViewportSize({ width: 1024, height: 640 });
  await open(page, "live=1");
  const required = ["live bar", "data version", "downloads", "settings panel", "zoom buttons"];
  expect(overlaps(await visibleBoxes(page, required))).toEqual([]);
});

/*
 * Tablets and small windows (Faza 57-C1). Between 721 and 1000 px there is no room for the filters, the details
 * and the bars side by side: the details take the filters' place while they are open. Up to 1200 px the bars
 * end where the details begin.
 */
for (const width of [800, 1100]) {
  test(`a ${String(width)} px window: details, bars, legend and zoom keep clear of one another`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "phones have their own layout, covered above");
    await page.setViewportSize({ width, height: 800 });
    await open(page, `live=1&v=44.7,13.85,9&sel=${encodeURIComponent(PIPELINE)}`);
    await expect(page.getByRole("heading", { name: "Plinovod Primjer" })).toBeVisible();
    const required = ["details", "live bar", "legend", "zoom buttons", "data version"];
    expect(overlaps(await visibleBoxes(page, required))).toEqual([]);
    // on a tablet the filters give way to the details, and come back when they close
    await expect(page.locator("#settings-panel")).toBeVisible({ visible: width > 1000 });
    await page.getByRole("button", { name: "Zatvori detalje" }).click();
    await expect(page.locator("#settings-panel")).toBeVisible();
  });
}

test("the search never covers the name in the header", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "phones put the search on a row of its own");
  await open(page, "");
  for (const width of [1100, 1200, 1280, 1350, 1440, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    const name = await page.locator("header h1").boundingBox();
    const search = await page.getByRole("combobox", { name: "Pretraga" }).boundingBox();
    if (!name || !search) throw new Error("the name and the search are in the header");
    expect(name.x + name.width, `at ${String(width)} px`).toBeLessThanOrEqual(search.x);
  }
});
