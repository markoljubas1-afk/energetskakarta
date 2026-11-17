import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = ""): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("a first visit gets three doors into the map, and the card does not come back once closed", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the card is for wide screens: a phone's first screen is the map itself");
  await open(page);
  const card = page.locator("[data-welcome]");
  await expect(card.getByRole("heading", { name: "Dobro došli na GridAtlas" })).toBeVisible();
  await card.getByRole("button", { name: /Tokovi struje uživo/ }).click();
  await expect(page).toHaveURL(/live=1/);
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.locator("[data-welcome]")).toHaveCount(0);
});

test("a shared link with a selection shows the object, not the card", async ({ page, isMobile }) => {
  test.skip(isMobile, "no card on phones");
  await open(page, "?sel=osm%3Anode%2F50&v=45.5,15.9,10");
  await expect(page.getByRole("complementary", { name: "Detalji objekta" })).toBeVisible();
  await expect(page.locator("[data-welcome]")).toHaveCount(0);
});

test("the legend plays down kinds that are not on screen", async ({ page, isMobile }) => {
  test.skip(isMobile, "the legend is not shown on phones");
  // zoomed onto the pumped-storage plant only: every other technology is off screen
  await open(page, "?l=plants&v=45.81,16.51,13");
  const legend = page.locator("details", { hasText: "Legenda" });
  if (!(await legend.evaluate((el: HTMLDetailsElement) => el.open))) await legend.locator("summary").click();
  await expect(legend.locator("li[data-absent]").first()).toBeVisible();
  await expect(legend.locator("li", { hasText: "Reverzibilna hidro" })).not.toHaveAttribute(
    "data-absent",
    /.*/,
  );
});
