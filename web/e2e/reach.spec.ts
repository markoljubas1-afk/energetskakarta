import { expect, test } from "@playwright/test";

/** Embedding, the change feed and the open JSON files (Faza 12). */

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("embed mode shows only the map with a way back to the full site", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/?embed=1&v=45.81,16.51,12&l=plants");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Pretraga" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filtri i pregled" })).toHaveCount(0);
  const back = page.getByRole("link", { name: "Otvori cijelu kartu" });
  await expect(back).toBeVisible();
  const href = await back.getAttribute("href");
  expect(href).toContain("l=plants");
  expect(href).not.toContain("embed");
  // the map still works: click the plant, see its details
  const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("heading", { name: "RHE Primjer" })).toBeVisible();
  // host pages own the keyboard: "?" does nothing here
  await page.keyboard.press("Escape");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the share menu hands out an iframe for this view", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/?v=45.81,16.51,12");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "Podijeli", exact: true }).click();
  await page.getByRole("button", { name: "Ugradi na svoju stranicu" }).click();
  const code = page.getByRole("textbox", { name: "Ugradi na svoju stranicu" });
  await expect(code).toHaveValue(
    /<iframe src="http:\/\/localhost:4173\/\?v=45\.81\d*%2C16\.51\d*%2C12[.0]*&amp;embed=1"/,
  );
});

test("the change feed and the open JSON files are served", async ({ request }) => {
  const feed = await request.get("/feed.xml");
  expect(feed.status()).toBe(200);
  const xml = await feed.text();
  expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="hr">');
  expect(xml).toContain("Elektrane");
  expect((await request.get("/en/feed.xml")).status()).toBe(200);

  const index = (await (await request.get("/api/index.json")).json()) as {
    endpoints: Record<string, string>;
    assets: number;
  };
  expect(index.endpoints.country).toContain("/api/zemlja/");
  expect(index.assets).toBeGreaterThan(3);
  const hr = (await (await request.get("/api/zemlja/hr.json")).json()) as {
    country: string;
    operatingMw: number;
  };
  expect(hr.country).toBe("HR");
  expect(hr.operatingMw).toBeGreaterThan(1000);
  const plant = (await (await request.get("/api/objekt/osm-way-109.json")).json()) as {
    name: string;
    capacityMw: number;
  };
  expect(plant).toMatchObject({ name: "RHE Primjer", capacityMw: 276 });
  const cities = (await (await request.get("/api/gradovi.json")).json()) as { cities: { id: string }[] };
  expect(cities.cities.map((c) => c.id)).toContain("com:1001");
});

test("the API page documents the endpoints in both languages", async ({ page }) => {
  await page.goto("/api/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Otvoreni JSON i feed promjena");
  await expect(page.getByText("http://localhost:4173/api/zemlja/hr.json").first()).toBeVisible();
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/api\/$/);
  await expect(page.locator('link[rel="alternate"][type="application/atom+xml"]')).toHaveAttribute(
    "href",
    "http://localhost:4173/en/feed.xml",
  );
});
