import { expect, test, type Page } from "@playwright/test";

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

test("a guided story walks the map through its steps and gives the map back at the end", async ({ page }) => {
  await open(page, "l=lines,plants&story=put-struje");
  const card = page.getByRole("region", { name: "Put struje od elektrane do utičnice" });
  await expect(card.getByRole("heading", { name: "Jedna mreža za cijelu regiju" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Natrag" })).toBeDisabled();
  // the first step shows the lines alone, whatever the link asked for
  await expect(page).not.toHaveURL(/plants/);

  await card.getByRole("button", { name: "Dalje" }).click();
  await expect(card.getByRole("heading", { name: "Sve počinje u elektrani" })).toBeVisible();
  await expect(page).toHaveURL(/l=lines%2Csubstations%2Cplants/);
  await expect(page).toHaveURL(/story=put-struje/);
  // the map has moved to the step's place (Krško, zoom 9.5)
  await expect(page).toHaveURL(/v=45\.9\d+%2C15\.5\d+%2C9\.50/, { timeout: 20_000 });

  await card.getByRole("button", { name: "Natrag" }).click();
  await expect(card.getByRole("heading", { name: "Jedna mreža za cijelu regiju" })).toBeVisible();

  await card.getByRole("button", { name: "Zatvori priču" }).click();
  await expect(card).toHaveCount(0);
  await expect(page).not.toHaveURL(/story=/);
  // what the reader had before the story is back
  await expect(page).toHaveURL(/l=lines%2Cplants/);
});

test("the learning page links to the stories", async ({ page }) => {
  await page.goto("/edukacija/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Edukacijski kutak");
  await expect(page.getByRole("link", { name: "Zašto su granice važne" })).toHaveAttribute(
    "href",
    "/?story=granice",
  );
  await expect(page.locator("dl dt")).toHaveCount(13);
});
