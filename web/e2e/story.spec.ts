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
  await expect(page.locator(".glossary details")).toHaveCount(14);
  // the live box is filled by the page's own small script from the same data the map reads
  const now = page.locator("[data-live-now]");
  await expect(now).toBeVisible();
  await expect(now).toContainText(/\d+ % proizvodnje je iz obnovljivih izvora/);
  await expect(now).toHaveAttribute("data-band", /^(low|mid|high|stale)$/);
  await expect(now.locator('[data-part="price"]')).toContainText(
    /Cijena na burzi \(dan unaprijed\): [\d.,−-]+ €\/MWh/,
  );
  // a story card says what it does
  await expect(page.locator(".doors em", { hasText: "Pokreni priču" }).first()).toBeVisible();
  // the navigation leads to the list of monthly reports
  await expect(
    page.getByRole("navigation", { name: "Glavna navigacija" }).getByRole("link", { name: "Izvještaji" }),
  ).toHaveAttribute("href", "/izvjestaji/");
});

test("the kilowatt-hour story sends a point along a real route, which can be paused and replayed", async ({
  page,
}) => {
  // the test build's lines make no route; hand the page one, as a build with routes.json would
  await page.route(/\/local-data\/current\.json/, async (route) => {
    const response = await route.fetch();
    const current = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...current, routes: "routes-test.json" } });
  });
  await page.route("**/local-data/routes-test.json", (route) =>
    route.fulfill({
      json: {
        version: 1,
        source: "OpenStreetMap",
        license: "ODbL-1.0",
        routes: {
          "dalmacija-zagreb": {
            from: "Konjsko",
            to: "Tumbri",
            minKv: 380,
            km: 250,
            lines: 1,
            stops: [
              [16.501, 43.602],
              [15.868, 45.681],
            ],
            coordinates: [
              [16.501, 43.602],
              [16.2, 44.6],
              [15.868, 45.681],
            ],
          },
        },
      },
    }),
  );
  await open(page, "story=kilovatsat");
  const card = page.getByRole("region", { name: "Put jednog kilovatsata" });
  await expect(card.getByRole("heading", { name: "Ovdje hvatamo vjetar" })).toBeVisible();
  await card.getByRole("button", { name: "Dalje" }).click();
  await expect(card.getByRole("heading", { name: "Priprema za put" })).toBeVisible();
  await card.getByRole("button", { name: "Dalje" }).click();
  await expect(card.getByRole("heading", { name: "Energetska autocesta" })).toBeVisible();

  // the point is on its way: it can be stopped, sent on, and started again
  await expect(card.getByText("Točka je ilustracija, ne stvarni tok.")).toBeVisible();
  await card.getByRole("button", { name: "Pauza" }).click();
  await expect(card.getByRole("button", { name: "Pusti" })).toBeEnabled();
  await card.getByRole("button", { name: "Pusti" }).click();
  await expect(card.getByRole("button", { name: "Pauza" })).toBeVisible();
  await card.getByRole("button", { name: "Ispočetka" }).click();
  await expect(card.getByRole("button", { name: "Pauza" })).toBeVisible();

  await card.getByRole("button", { name: "Dalje" }).click();
  await expect(card.getByRole("heading", { name: "Silazak s autoceste" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Pauza" })).toHaveCount(0);
});

test("without a route in the build the kilowatt-hour story is not played", async ({ page }) => {
  await open(page, "story=kilovatsat");
  await expect(page.getByRole("region", { name: "Put jednog kilovatsata" })).toHaveCount(0);
});
