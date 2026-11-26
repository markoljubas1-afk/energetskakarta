import { expect, test } from "@playwright/test";

/** The static pages, sitemap and crawler files that `npm run build` writes next to the app. */

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the about page is complete HTML with structured data and links back to the map", async ({ page }) => {
  await page.goto("/o-karti/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("O karti: izvori, licence i način rada");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "http://localhost:4173/o-karti/",
  );
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
    "href",
    "http://localhost:4173/en/about/",
  );
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = jsonLd.map((text) => (JSON.parse(text) as { "@type": string })["@type"]);
  expect(types).toEqual(["Dataset", "FAQPage", "BreadcrumbList"]);
  await expect(page.getByRole("link", { name: "Hrvatska" }).first()).toHaveAttribute("href", "/zemlja/hr/");
  await expect(page.getByRole("link", { name: /Dalekovodi i kabeli/ })).toHaveAttribute(
    "href",
    /local-data\/builds\/.*\/lines\.ndjson\.gz$/,
  );
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/About the map/);
});

test("the static pages fit the screen: a wide table scrolls in its own box, not the page", async ({
  page,
}) => {
  for (const path of ["/o-karti/", "/zemlja/hr/", "/edukacija/", "/najvece-elektrane/", "/en/api/"]) {
    await page.goto(path);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(wide, path).toBe(false);
  }
});

test("a country page carries that country's figures", async ({ page }) => {
  await page.goto("/zemlja/hr/");
  await expect(page).toHaveTitle("Hrvatska: elektrane, dalekovodi i trafostanice");
  // the capacity is a chart, with its table behind a click (Faza 54-3)
  await expect(page.locator(".kpis")).toContainText("Snaga u pogonu");
  await page.getByText("Tablica s brojkama").first().click();
  await expect(page.getByRole("rowheader", { name: "Reverzibilna hidro" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Otvori na karti" })).toHaveAttribute("href", "/?c=HR");
});

test("an asset page opens the map on that asset", async ({ page }) => {
  await page.goto("/objekt/osm-way-109/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("RHE Primjer");
  await expect(page.getByText("276 MW").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /OpenStreetMapu/ })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/way/109",
  );
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.getByRole("link", { name: "Prikaži na karti" }).click();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "RHE Primjer" })).toBeVisible();
});

test("robots.txt, sitemap.xml and llms.txt are served and consistent", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("User-agent: GPTBot\nAllow: /");
  expect(robots).toContain("Sitemap: http://localhost:4173/sitemap.xml");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("<loc>http://localhost:4173/</loc>");
  expect(sitemap).toContain("<loc>http://localhost:4173/objekt/osm-way-109/</loc>");
  expect(sitemap).toContain("<loc>http://localhost:4173/en/country/hr/</loc>");
  // every listed page really exists
  const locs = [...sitemap.matchAll(/<loc>http:\/\/localhost:4173(\/[^<]*)<\/loc>/g)].map((m) => m[1] ?? "");
  expect(locs.length).toBeGreaterThan(10);
  for (const loc of locs.filter((l) => l.endsWith("/") && l !== "/")) {
    expect((await request.get(loc)).status(), loc).toBe(200);
  }

  const llms = await (await request.get("/llms.txt")).text();
  expect(llms.startsWith("# GridAtlas")).toBe(true);
  expect(llms).toContain("http://localhost:4173/en/about/");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the home page still says what the site is and links to the static pages", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "GridAtlas: Regionalna energetska karta",
    );
    await expect(page.getByRole("link", { name: /O karti/ })).toHaveAttribute("href", "/o-karti/");
    // the intro list and the country summary both link Slovenia
    await expect(page.getByRole("link", { name: "Slovenija" }).first()).toHaveAttribute(
      "href",
      "/zemlja/si/",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://localhost:4173/");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      "http://localhost:4173/og-gridatlas.png",
    );
  });
});

test.describe("the English map at /en/", () => {
  test.use({ javaScriptEnabled: false });

  test("is English before any script runs, with alternates to the Croatian one", async ({ page }) => {
    await page.goto("/en/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("GridAtlas: Regional energy map");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://localhost:4173/en/");
    await expect(page.locator('link[rel="alternate"][hreflang="hr"]')).toHaveAttribute(
      "href",
      "http://localhost:4173/",
    );
    await expect(page.getByRole("link", { name: "Croatia" }).first()).toHaveAttribute(
      "href",
      "/en/country/hr/",
    );
  });
});

test("an old ?lang=en link opens the English map at /en/", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/?lang=en&c=HR");
  await expect(page).toHaveURL(/\/en\/\?c=HR$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("a topic page lists the country's assets of one kind and links each to its own page", async ({
  page,
}) => {
  await page.goto("/zemlja/hr/reverzibilne-hidroelektrane/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reverzibilne hidroelektrane u Hrvatskoj");
  // the planned unit of the same plant (known only to GEM) carries the same name and is listed too
  // the list's own link (the chart of the largest above it links the same page, D4)
  const plant = page.locator('table a[href="/objekt/osm-way-109/"]');
  await expect(plant).toHaveText("RHE Primjer");
  await expect(page.locator('.ranking a[href="/objekt/osm-way-109/"]')).toHaveText("RHE Primjer");
  const crumbs = page.getByRole("navigation", { name: "Putanja" });
  await expect(crumbs.getByRole("link", { name: "Hrvatska" })).toHaveAttribute("href", "/zemlja/hr/");
  await plant.click();
  await expect(page).toHaveTitle("RHE Primjer: reverzibilna hidroelektrana 276 MW, Hrvatska");
});

test("the map links to the about page in the reader's language", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "O karti" })).toHaveAttribute("href", "/o-karti/");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("link", { name: "About" })).toHaveAttribute("href", "/en/about/");
});

test("every page has a Markdown twin and the main pages are in llms-full.txt", async ({ request }) => {
  const twin = await request.get("/zemlja/hr/index.md");
  expect(twin.status()).toBe(200);
  expect(await twin.text()).toMatch(/^# .*Hrvatska\n/);
  const full = await request.get("/llms-full.txt");
  expect(full.status()).toBe(200);
  expect(await full.text()).toContain("full text of the main pages");
});

test("the energy transition page has its indicators, methodology and structured data", async ({ page }) => {
  await page.goto("/zemlja/hr/");
  await page.getByRole("link", { name: "Zelena tranzicija: pokazatelji za Hrvatsku" }).click();
  await expect(page).toHaveURL(/\/zelena-tranzicija\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Zelena tranzicija u Hrvatskoj" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Metodologija i ograničenja" })).toBeVisible();
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.join(" ")).toContain('"variableMeasured"');
  const md = await page.request.get("/zelena-tranzicija/index.md");
  expect(md.ok()).toBe(true);
});

test("the geothermal page is reached from the transition page and names a source for every site", async ({
  page,
}) => {
  await page.goto("/zelena-tranzicija/");
  await page.getByRole("link", { name: "Geotermalna energija: elektrane, toplina i potencijal" }).click();
  await expect(page).toHaveURL(/\/geotermalna-energija\/$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Geotermalna energija u Hrvatskoj" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kako se toplina koristi: kaskada" })).toBeVisible();
  for (const item of await page.locator("main li:has(strong)").all()) {
    await expect(item.locator("a[href^='http']").first()).toBeVisible();
  }
  const md = await page.request.get("/geotermalna-energija/index.md");
  expect(md.ok()).toBe(true);
});
