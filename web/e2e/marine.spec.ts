import { expect, test, type Page } from "@playwright/test";

/** EMODnet sample from pipeline/tests/fixtures/emodnet: "Plinovod Primjer" (gas, HR) runs from
 * 13.90,44.60 to 13.80,44.70 and on to 13.85,44.85. */
const PIPELINE = "emodnet:pipelines/101";

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

test("a shared link opens an offshore pipeline with its source", async ({ page }) => {
  await open(page, `v=44.7,13.85,9&sel=${encodeURIComponent(PIPELINE)}`);
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "Plinovod Primjer" })).toBeVisible();
  await expect(details).toContainText("Podmorski cjevovod");
  await expect(details).toContainText("Plin");
  await expect(details).toContainText("76 km");
  await expect(details.getByText("Izvori: EMODnet")).toBeVisible();
  await expect(details.getByRole("link")).toHaveCount(0);
  await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toContainText("EMODnet Human Activities");
});

test("clicking the pipeline selects it; switching the layer off makes it unclickable", async ({ page }) => {
  // centre on the middle of the first segment
  await open(page, "v=44.65,13.85,11");
  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(center.x, center.y);
  await expect(page).toHaveURL(new RegExp(`sel=${encodeURIComponent(PIPELINE)}`));
  await page.getByRole("button", { name: "Zatvori detalje" }).click();

  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("checkbox", { name: /Cjevovodi \(more\)/ }).uncheck();
  // the exact layer list grows as layers are added; what matters is that pipelines left it
  await expect(page).not.toHaveURL(/pipelines/);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await page.mouse.click(center.x, center.y);
  await expect(page).not.toHaveURL(/sel=/);
});

test("the pipelines download and legend entry are offered", async ({ page }, testInfo) => {
  await open(page, "v=44.7,13.85,8");
  await page.getByRole("button", { name: "Preuzmi bazu", exact: true }).click();
  await expect(page.getByRole("link", { name: "Cjevovodi (more)" })).toHaveAttribute(
    "href",
    /pipelines\.ndjson\.gz$/,
  );
  // the legend is a desktop element (phones hide it to keep the map usable)
  if (testInfo.project.name === "desktop") {
    const legend = page.locator("details", { hasText: "Legenda" });
    if (!(await legend.evaluate((el: HTMLDetailsElement) => el.open)))
      await legend.locator("summary").click();
    await expect(page.getByRole("heading", { name: "Cjevovodi na moru" })).toBeVisible();
  }
});

test("offshore snapshot", async ({ page }, testInfo) => {
  await open(page, `v=44.7,13.9,8.5&sel=${encodeURIComponent(PIPELINE)}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-marine.png`) });
});
