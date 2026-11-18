import { expect, test, type Page } from "@playwright/test";

/** Synthetic live data from pipeline/scripts/web_fixture.py: ME–BA never reports, BA and ME have no market,
 * and SI–HR is missing for the first hour of today. */

async function openLive(page: Page, query = ""): Promise<void> {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto(`/?live=1${query}`);
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" })).toBeVisible();
}

async function hours(page: Page): Promise<string[]> {
  const response = await page.request.get("/local-data/live/current.json");
  const body = (await response.json()) as { hours: string[] };
  return body.hours;
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the layer is switched on from the layer list and shows flows and prices", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("checkbox", { name: "Tokovi i cijene (uživo)" }).check();
  await expect(page).toHaveURL(/live=1/);
  if (await page.getByRole("button", { name: "Sakrij filtre i pregled" }).isVisible()) {
    await page.getByRole("button", { name: "Sakrij filtre i pregled" }).click();
  }
  const bar = page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" });
  await expect(bar.getByText("Testni podaci, nisu stvarni")).toBeVisible();
  await expect(page.locator('[data-live-label^="flow-"]').first()).toBeVisible();
  await expect(page.locator('[data-live-label="price-HR"]')).toContainText("€/MWh");
  await expect(page.locator('[data-live-label="price-BA"]')).toHaveCount(0); // no market, no number
});

test("an hour without data shows no arrow and says so in the table", async ({ page }) => {
  const all = await hours(page);
  const todayMidnight = all.find((h) => h.slice(0, 10) === all[36]?.slice(0, 10)) ?? "";
  await openLive(page, `&lt=${todayMidnight.slice(0, 13)}`);
  const bar = page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" });
  await expect(bar.getByText("danas 00:00")).toBeVisible();
  await expect(page.locator('[data-live-label="flow-SI-HR"]')).toHaveCount(0);
  await expect(page.locator('[data-live-label^="flow-"]').first()).toBeVisible();
  await bar.getByText("Brojke za odabrani sat").click();
  await expect(bar.getByRole("row", { name: /Slovenija → Hrvatska/ })).toContainText("nema podataka");
  await expect(bar.getByText("Bez burze: Bosna i Hercegovina, Crna Gora.")).toBeVisible();
});

test("the hour can be changed with the keyboard and is kept in the link", async ({ page }) => {
  const all = await hours(page);
  // an older link without the offset still opens the right hour
  await openLive(page, `&lt=${all[10]?.slice(0, 13) ?? ""}`);
  const slider = page.getByRole("slider", { name: "Sat" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  // links carry the local hour and its UTC offset ("…T13+02"), encoded in the query
  const next = all[11] ?? "";
  const key = `${next.slice(0, 13)}${next.slice(-6, -3)}`;
  await expect(page).toHaveURL(new RegExp(`lt=${encodeURIComponent(key)}(&|$)`));
  await page.reload();
  await expect(page.getByRole("slider", { name: "Sat" })).toHaveValue("11");
});

test("unpublished live data is explained", async ({ page }) => {
  await page.route("**/local-data/live/current.json*", (route) => route.fulfill({ status: 404, body: "" }));
  await openLive(page);
  await expect(page.getByText("Tokovi i cijene još nisu objavljeni.")).toBeVisible();
  await expect(page.locator("[data-live-label]")).toHaveCount(0);
});

test("live layer snapshot", async ({ page }, testInfo) => {
  await openLive(page, "&v=45.0000,15.5000,5.30");
  await page.waitForTimeout(600);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-live.png`) });
});

test("flow direction is animated, unless the visitor prefers reduced motion", async ({ page }) => {
  await openLive(page);
  const map = page.locator("[data-map-status]");
  await expect(map).toHaveAttribute("data-flow-animation", "running");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(map).toHaveAttribute("data-flow-animation", "reduced");

  // off with the layer: nothing is left running
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(map).not.toHaveAttribute("data-flow-animation", /./);
});

test("the bars fold away to free the map and come back", async ({ page }) => {
  await openLive(page);
  const bar = page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" });
  await page.getByRole("button", { name: "Sakrij kartice" }).click();
  await expect(bar).toBeHidden();
  await expect(page).toHaveURL(/live=1/); // folded, not switched off
  await page.getByRole("button", { name: "Pokaži kartice" }).click();
  await expect(bar).toBeVisible();
});

test("the status bar says how green the electricity is, and explains the number", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/"); // the pill needs no layer: the hour's data is always loaded
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const pill = page.getByRole("button", { name: /^Udio obnovljivih u proizvodnji struje, Hrvatska: \d+ %$/ });
  await expect(pill).toBeVisible();
  await expect(pill).toContainText(/HR \d+ %/);
  await pill.click();
  await expect(page.getByText("Koliko je struja sada zelena")).toBeVisible();
  await expect(page.getByText("proizvodnje je iz obnovljivih izvora")).toBeVisible();
  await expect(page.getByRole("link", { name: "Zašto je to važno?" })).toHaveAttribute("href", "/edukacija/");
  await expect(page.getByRole("button", { name: /^Pokaži na karti: / })).toBeVisible();
});

test("the green card shows where the country stands against its 2030 target, asked for only when opened", async ({
  page,
}) => {
  // the test data has no Eurostat shares; hand the page a small document in the published shape
  let asked = 0;
  await page.route("**/local-data/eurostat/renewables.json", (route) => {
    asked += 1;
    return route.fulfill({
      json: {
        version: 1,
        dataset: "nrg_ind_ren",
        source: "Eurostat",
        sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/nrg_ind_ren/default/table",
        license: "CC-BY-4.0",
        updated: null,
        retrievedAt: "2026-11-16T00:00:00+00:00",
        indicators: ["REN"],
        years: [2023, 2024],
        series: { HR: { REN: [28.1, 34.0] } },
        flags: {},
        flagLabels: {},
        missing: [],
        contentHash: "test",
      },
    });
  });
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const pill = page.getByRole("button", { name: /^Udio obnovljivih u proizvodnji struje, Hrvatska/ });
  await expect(pill).toBeVisible();
  expect(asked).toBe(0);
  await pill.click();
  const goal = page.getByRole("region", { name: "Cilj 2030." });
  await expect(goal).toContainText("Službeni udio 2024.: 34 %");
  await expect(goal).toContainText("Cilj za 2030.: 42,5 %");
  await expect(goal).toContainText("Do cilja još 8,5 post. bodova");
  await expect(goal).toContainText("Nije ista mjera kao brojka iznad");
  // the card grew after it opened: the menu is still wholly on screen, and what does not fit a phone
  // is reached by scrolling inside it
  const menu = await page.locator("[data-green]").locator("xpath=ancestor::*[@popover][1]").boundingBox();
  const screen = page.viewportSize();
  if (!menu || !screen) throw new Error("no menu box");
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(screen.height);
  await goal.scrollIntoViewIfNeeded();
  const box = await goal.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("no box");
  // the target's own region fits a phone screen, or at least starts on it
  expect(box.y).toBeLessThan(viewport.height);
  expect(box.y + Math.min(box.height, 120)).toBeGreaterThan(0);

  // what is on its way towards the target: the country's wind and solar plants being built and planned
  await goal.getByRole("button", { name: "Pokaži što se gradi i planira: vjetar i sunce" }).click();
  await expect(page).toHaveURL(/[?&]s=[^&]*planned/);
  await expect(page).toHaveURL(/[?&]s=[^&]*construction/);
  await expect(page).not.toHaveURL(/[?&]s=[^&]*operating/);
  await expect(page).toHaveURL(/[?&]t=[^&]*wind/);
  await expect(page).toHaveURL(/[?&]t=[^&]*solar/);
  await expect(page).toHaveURL(/[?&]c=HR(&|$)/);
  await expect(page).toHaveURL(/[?&]l=[^&]*plants/);
});

test("a record day is shown in place of today, says so, and gives today back", async ({ page }) => {
  // the test data has no record days; offer one, served by the synthetic document's own middle day
  const all = await hours(page);
  const date = (all[Math.floor(all.length / 2)] ?? "").slice(0, 10);
  await page.route("**/local-data/live/days/index.json", (route) =>
    route.fulfill({
      json: {
        version: 1,
        generatedAt: "2026-11-17T16:00:00+00:00",
        source: "ENTSO-E Transparency Platform",
        country: "HR",
        days: [
          {
            date,
            key: `live/days/${date}.json`,
            records: [{ kind: "wind", value: 25064, unit: "MWh" }],
          },
        ],
        missing: [],
      },
    }),
  );
  await page.route(`**/local-data/live/days/${date}.json`, async (route) => {
    const response = await page.request.get("/local-data/live/current.json");
    await route.fulfill({ contentType: "application/json", body: await response.text() });
  });
  await openLive(page);
  const bar = page.getByRole("region", { name: "Tokovi preko granica i cijene po satu" });
  const picker = bar.getByRole("combobox", { name: "Povijesni dani" });
  await expect(picker).toHaveValue("");
  await picker.selectOption(date);
  await expect(page).toHaveURL(new RegExp(`[?&]ld=${date}`));
  await expect(bar.getByText(/^Gledate prošli dan/)).toContainText("najviše struje iz vjetra (25,1 GWh)");
  // a past day opens at its noon, named by its date, not as "today"
  await expect(bar.locator("output")).toContainText("12:00");
  await expect(bar.locator("output")).not.toContainText("Danas");
  await expect(page.locator('[data-live-label^="flow-"]').first()).toBeVisible();

  await bar.getByRole("button", { name: "Natrag na danas" }).click();
  await expect(page).not.toHaveURL(/[?&]ld=/);
  await expect(bar.getByText(/^Gledate prošli dan/)).toHaveCount(0);
  await expect(picker).toHaveValue("");
});
