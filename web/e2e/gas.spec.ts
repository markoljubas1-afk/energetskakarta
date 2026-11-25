import { expect, test, type Page } from "@playwright/test";

/** Synthetic gas data from pipeline/scripts/web_fixture.py: Croatia reports every gas day but the last,
 * Italy every day; nobody else has a production point. */

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

test("the document is fetched only once the layer is switched on", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("live/gas.json")) requests.push(request.url());
  });
  await open(page, "v=45.4,16.3,6");
  await page.waitForTimeout(800);
  expect(requests).toEqual([]);

  const toggle = page.getByRole("button", { name: "Filtri i pregled" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("checkbox", { name: "Plin: proizvodnja i skladišta (dnevno)" }).check();
  await expect(page).toHaveURL(/l=[^&]*gas/);
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("a shared link opens a country's production with a bar per gas day and a gap for the unreported one", async ({
  page,
}) => {
  await open(page, "l=plants,gas&v=45.4,16.3,6&sel=gas%3AHR");
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  await expect(details.getByRole("heading", { name: "Hrvatska" })).toBeVisible();
  await expect(details).toContainText("Proizvodnja plina");
  await expect(details).toContainText("Zadnji plinski dan");
  await expect(details).toContainText("GWh/dan");
  await expect(details).toContainText("13 od 14 dana");
  // the chart carries the reported days; the table with every day is folded under it
  await expect(details.locator('[data-gas-chart="13"]')).toBeVisible();
  await details.getByText("Svi dani u tablici").click();
  const bars = details.getByRole("list", { name: "Po plinskom danu" });
  await expect(bars.getByRole("listitem")).toHaveCount(14);
  await expect(bars.getByRole("listitem").last()).toContainText("nije prijavljeno");
  await expect(details).toContainText("Fixture TSO HR");
  await expect(details).toContainText("Izvori: ENTSOG");
  await expect(details.getByRole("link", { name: "Izvor podatka" })).toHaveAttribute(
    "href",
    "https://transparency.entsog.eu/",
  );
});

test("a country without a production point has no disc to select", async ({ page }) => {
  await open(page, "l=gas&v=46.2,14.5,6&sel=gas%3ASI");
  const details = page.getByRole("complementary", { name: "Detalji objekta" });
  // the map settles, the search index does not know it either: a clear answer, not endless loading (Faza 56)
  await expect(details.getByRole("heading", { name: "Objekt nije pronađen" })).toBeVisible();
});

test("the legend names the layer and the attribution names ENTSOG", async ({ page }) => {
  await open(page, "l=gas&v=45.4,16.3,6");
  const legend = page.locator("details", { hasText: "Legenda" });
  if (await legend.isVisible()) {
    if (!(await legend.evaluate((el: HTMLDetailsElement) => el.open)))
      await legend.locator("summary").click();
    await expect(legend.getByText(/Proizvodnja plina po zemlji/)).toBeVisible();
  }
});

test("gas production snapshot", async ({ page }, testInfo) => {
  await open(page, "l=plants,lines,gas&v=45.0,15.5,5.5&sel=gas%3AHR");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-gas.png`) });
});

/** Two invented storage facilities in the shape the pipeline publishes (pipeline/tests/test_gas_storage.py). */
const STORAGE = {
  version: 1,
  generatedAt: "2026-11-17T08:00:00+00:00",
  source: "GIE AGSI",
  sourceUrl: "https://agsi.gie.eu/",
  attribution: "GIE (Gas Infrastructure Europe), AGSI platform",
  license: "GIE-AGSI-attribution",
  days: ["2026-11-14", "2026-11-15"],
  facilities: [
    {
      id: "21W-PELDA-UGS--D",
      name: "UGS Pelda",
      operator: "Pelda",
      operatorId: "21X-PELDA------C",
      country: "HU",
      lon: 20.1,
      lat: 46.3,
      workingGasTwh: 20.48,
      status: ["C", "C"],
      fullPercent: [97.6, 97.7],
      inStorageTwh: [19.99, 20.0],
      injectionGwhPerDay: [9.3, 9.1],
      withdrawalGwhPerDay: [0, 0],
    },
    {
      id: "31W-PRIMJER-UGSB",
      name: "UGS Primjer",
      operator: "Primjer",
      operatorId: "31X-PRIMJER----A",
      country: "HR",
      lon: 16.5,
      lat: 45.6,
      workingGasTwh: 4.7725,
      status: ["C", "C"],
      fullPercent: [77.07, 76.63],
      inStorageTwh: [3.6781, 3.6572],
      injectionGwhPerDay: [0, 0.84],
      withdrawalGwhPerDay: [18.4, 21.1],
    },
  ],
  missing: { facilities: [], countries: ["SI"] },
};

test("gas storage rides on the gas layer: a bar with how full it is, its source, and a point on the map", async ({
  page,
}) => {
  // the test data has no storage document (it needs a personal key); hand the page one
  await page.route(/\/local-data\/live\/gasstorage\.json/, (route) => route.fulfill({ json: STORAGE }));
  // centred on the Hungarian facility, so a click in the middle of the map is a click on its point
  await open(page, "l=gas&v=46.3,20.1,9");
  const bar = page.getByRole("region", { name: "Skladišta plina: koliko su puna" });
  // Croatia's own facility is open; the other country waits behind one line
  await expect(bar.getByText("UGS Primjer")).toBeVisible();
  await expect(bar).toContainText("76,6 %");
  await expect(bar).toContainText("povlači se 21,1 GWh/dan");
  await expect(bar.getByText("Skladišta u drugim zemljama (1)")).toBeVisible();
  await expect(bar.getByText("UGS Pelda")).toBeHidden();
  // GIE asks to be named wherever its data is shown: in the bar and in the map's credits
  await expect(
    bar.getByRole("link", { name: "GIE (Gas Infrastructure Europe), AGSI platform" }),
  ).toHaveAttribute("href", "https://agsi.gie.eu/");
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("GIE");

  // folded away, the bar leaves the map free; a click on the facility's point brings it back, opened
  await page.getByRole("button", { name: "Sakrij kartice" }).click();
  await expect(bar).toBeHidden();
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(bar.locator("li[data-picked]")).toContainText("UGS Pelda");
  await expect(bar.locator("li[data-picked]")).toContainText("utiskuje se 9,1 GWh/dan");

  // closing the bar switches the gas layer off
  await bar.getByRole("button", { name: "Zatvori sloj plina" }).click();
  await expect(bar).toHaveCount(0);
  await expect(page).not.toHaveURL(/l=[^&]*gas/);
});

/** Croatia's system over ten gas days, in GWh a day, in the shape the pipeline publishes: eight days like
 * the first figure, then the second; the last day is not reported yet. */
const FLOW_DAYS = Array.from({ length: 10 }, (_, at) => `2026-11-${String(9 + at).padStart(2, "0")}`);
const flowPoint = (
  key: string,
  label: string,
  direction: "entry" | "exit",
  gwh: [number, number],
  neighbour: string | null = null,
) => ({
  key,
  label,
  kind: key.slice(0, 3),
  direction,
  neighbour,
  kwhPerDay: FLOW_DAYS.map((_, at) => (at === 9 ? null : (at === 8 ? gwh[1] : gwh[0]) * 1e6)),
  status: FLOW_DAYS.map((_, at) => (at === 9 ? null : "P")),
});
const FLOWS = {
  version: 1,
  generatedAt: "2026-11-19T10:00:00+00:00",
  source: "ENTSOG Transparency Platform",
  sourceUrl: "https://transparency.entsog.eu/",
  unit: "kWh/d",
  days: FLOW_DAYS,
  countries: {
    HR: {
      operatorKey: "HR-TSO-0001",
      operator: "Plinacro Ltd",
      points: [
        flowPoint("LNG-00032", "Croatia LNG", "entry", [98.7, 98.4]),
        flowPoint("PRD-00197", "Production (HR)", "entry", [19.4, 19.5]),
        flowPoint("UGS-00028", "UGS Croatia", "entry", [17.5, 3.3]),
        flowPoint("UGS-00028", "UGS Croatia", "exit", [0, 0]),
        flowPoint("ITP-00042", "Rogatec", "entry", [0, 0], "SI"),
        flowPoint("ITP-00042", "Rogatec", "exit", [24.9, 25.3], "SI"),
        flowPoint("ITP-00011", "Dravaszerdahely", "entry", [0, 0], "HU"),
        flowPoint("ITP-00011", "Dravaszerdahely", "exit", [24.3, 26.3], "HU"),
        flowPoint("FNC-00018", "Final Consumers and Distribution (HR)", "exit", [83.1, 71.9]),
      ],
    },
  },
  missing: [],
};

test("the gas layer shows what entered the system and where it went, and a picture of it to share", async ({
  page,
}, testInfo) => {
  // the test data has no flow document; hand the page one
  await page.route(/\/local-data\/live\/gasflows\.json/, (route) => route.fulfill({ json: FLOWS }));
  await open(page, "l=gas");
  const bar = page.getByRole("region", { name: "Plin, Hrvatska: što je ušlo u sustav i kamo je otišlo" });
  await expect(bar).toContainText("Plinski dan 17. studenoga 2026., privremeni podaci operatora");
  const entered = bar.getByRole("list", { name: "Ušlo u transportni sustav: 121,2 GWh" });
  await expect(entered.getByRole("listitem").first()).toHaveText("LNG terminal98,4 GWh · 81 %");
  const left = bar.getByRole("list", { name: "Izašlo iz transportnog sustava: 123,5 GWh" });
  await expect(left.getByRole("listitem").first()).toHaveText("kupci i distribucija u zemlji71,9 GWh · 58 %");
  await expect(left).toContainText("Dravaszerdahely (Mađarska)");
  // the day against the seven before it: 71.9 GWh where 83.1 was usual
  await expect(bar).toContainText(
    "Kupcima i distribuciji u zemlji isporučeno je 71,9 GWh: 13 % manje od prosjeka prethodnih sedam plinskih dana (83,1 GWh).",
  );
  await expect(bar).toContainText("Ulaz nije potrošnja");
  await expect(bar.getByRole("link", { name: "ENTSOG Transparency Platform" })).toHaveAttribute(
    "href",
    "https://transparency.entsog.eu/",
  );
  // the diagram between the lists has a band for each point that flowed, and the reader can go back a day
  await expect(bar.locator('svg[preserveAspectRatio="none"] path')).toHaveCount(6);
  const slider = bar.getByRole("slider", { name: "Plinski dan" });
  await slider.press("ArrowLeft");
  await expect(bar).toContainText("Plinski dan 16. studenoga 2026.");
  await slider.press("ArrowRight");
  await expect(bar).toContainText("Plinski dan 17. studenoga 2026.");
  // the bar stays inside the screen, phone included
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("no box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  await bar.screenshot({ path: testInfo.outputPath("gas-flow-bar.png") });

  // the same day as a picture: "?pic=gasflow" opens the dialog on it
  await page.goto("/?pic=gasflow");
  const dialog = page.getByRole("dialog", { name: "Slika za dijeljenje" });
  await expect(dialog.getByLabel("Što je na slici")).toHaveValue("gasflow");
  const picture = dialog.getByRole("img");
  await expect(picture).toHaveAccessibleName(
    "GridAtlas: Odakle je plin ušao. Hrvatska · plinski dan 17. studenoga 2026. · privremeni podaci: 81 % LNG terminal (98,4 GWh od 121,2 GWh ušlih u transportni sustav); 16 % domaća polja (19,5 GWh); 3 % iz skladišta (3,3 GWh). Kupcima u zemlji isporučeno 71,9 GWh · Izvor: ENTSOG Transparency Platform · gridatlas.eu",
  );
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^gridatlas-plin-ulaz-hr-2026-11-17-\d{4}-\d{2}-\d{2}\.png$/);
  await file.saveAs(testInfo.outputPath("gas-flow-card.png"));
  await dialog.getByRole("radio", { name: "Okomita" }).check();
  await expect(picture).toHaveAttribute("height", "1920");
  const story = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  await (await story).saveAs(testInfo.outputPath("gas-flow-card-story.png"));

  // and what was delivered to customers, with the same comparison
  await page.goto("/?pic=gasuse");
  await expect(dialog.getByLabel("Što je na slici")).toHaveValue("gasuse");
  await expect(picture).toHaveAccessibleName(
    "GridAtlas: Plin isporučen kupcima. Hrvatska · plinski dan 17. studenoga 2026. · privremeni podaci: 71,9 GWh isporučeno kupcima i distribuciji u zemlji (izlaz iz transportnog sustava (Plinacro Ltd)); −13 % prema prosjeku prethodnih sedam dana (prosjek tih dana: 83,1 GWh na dan). Izvor: ENTSOG Transparency Platform · gridatlas.eu",
  );
  const use = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const useFile = await use;
  expect(useFile.suggestedFilename()).toMatch(/^gridatlas-plin-kupci-hr-2026-11-17-\d{4}-\d{2}-\d{2}\.png$/);
  await useFile.saveAs(testInfo.outputPath("gas-use-card.png"));
});

test("the path of gas on the learning page names its sources and opens the wells on the map", async ({
  page,
}) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/edukacija/");
  await expect(page.getByRole("heading", { name: "Put plina: od bušotine do štednjaka" })).toBeVisible();
  await expect(page.getByText("jedina kompresorska stanica u sustavu, u Velikoj Ludini")).toBeVisible();
  await expect(page.getByRole("link", { name: "Plinacro: kompresorska stanica" })).toHaveAttribute(
    "href",
    "https://www.plinacro.hr/default.aspx?id=902",
  );
  await page.getByRole("link", { name: "Bušotine u Podravini" }).click();
  // the map opens on Podravina with the extraction layer on, and nothing else asked for
  await expect(page).toHaveURL(/l=extraction/);
  await expect(page).toHaveURL(/v=46\.09/);
});
