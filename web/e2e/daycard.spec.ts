import { expect, test } from "@playwright/test";

/** The day in three figures, as a picture to save: opened from the share menu, drawn in the browser. */

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the share menu opens the day card, which is drawn and saved as a PNG", async ({ page }, testInfo) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  // the test data is of a fixed day and the card refuses old figures: set the clock to just after the last
  // hour Croatia reported
  const response = await page.request.get("/local-data/live/current.json");
  const live = (await response.json()) as {
    hours: string[];
    generation: Record<string, Record<string, (number | null)[]>>;
  };
  const reported = Object.values(live.generation.HR ?? {});
  const last = live.hours.findLastIndex((_, index) => reported.some((values) => values[index] != null));
  const hour = live.hours[last];
  if (hour === undefined) throw new Error("the test data has no generation for Croatia");
  await page.clock.install({ time: new Date(Date.parse(hour) + 90 * 60_000) });
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "Podijeli", exact: true }).click();
  await page.getByRole("button", { name: "Slika za dijeljenje: brojke dana, izvori energije" }).click();

  const dialog = page.getByRole("dialog", { name: "Slika za dijeljenje" });
  await expect(dialog).toBeVisible();
  const picture = dialog.getByRole("img");
  await expect(picture).toHaveAccessibleName(
    /% obnovljivi izvori u proizvodnji struje \(sat od \d\d:00, bez uvoza\)/,
  );
  await expect(picture).toHaveAccessibleName(/ENTSO-E Transparency Platform/);
  await expect(dialog).toContainText("Slobodno dijeljenje uz navođenje izvora: gridatlas.eu.");

  // something was really drawn: the top-left pixel carries the card's bar, not an empty canvas
  const painted = await picture.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext("2d")?.getImageData(4, 4, 1, 1).data;
    return data ? data[3] : 0;
  });
  expect(painted).toBe(255);

  // the dialog fits the screen, phone included
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("no box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^gridatlas-dan-[a-z]{2}-\d{4}-\d{2}-\d{2}\.png$/);
  await file.saveAs(testInfo.outputPath("day-card.png"));

  // the upright shape for a story: the same figures on a 1080 × 1920 picture, under its own file name
  await dialog.getByRole("radio", { name: "Okomita" }).check();
  await expect(picture).toHaveAttribute("height", "1920");
  const shown = await picture.boundingBox();
  const fits = await dialog.boundingBox();
  if (!shown || !fits) throw new Error("no box");
  // shown whole and undistorted, inside a dialog that still fits the screen
  expect(shown.width / shown.height).toBeCloseTo(1080 / 1920, 1);
  expect(fits.y + fits.height).toBeLessThanOrEqual(viewport.height);
  const story = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const upright = await story;
  expect(upright.suggestedFilename()).toMatch(/^gridatlas-dan-[a-z]{2}-story-\d{4}-\d{2}-\d{2}\.png$/);
  await upright.saveAs(testInfo.outputPath("day-card-story.png"));

  // what the electricity of the latest complete day was made of: a ring of sources, from the daily totals
  const kind = dialog.getByLabel("Što je na slici");
  await kind.selectOption({ label: "Izvori električne energije: zadnji potpuni dan" });
  await expect(picture).toHaveAccessibleName(
    /^GridAtlas: izvori električne energije\. Hrvatska · \d+\. \S+ \d{4}\. · cijeli dan: \d+ % obnovljivi izvori; /,
  );
  await expect(picture).toHaveAccessibleName(/ Proizvodnja; .* Potrošnja; /);
  const still = await dialog.boundingBox();
  if (!still) throw new Error("no box");
  expect(still.y + still.height).toBeLessThanOrEqual(viewport.height);
  const sources = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const ring = await sources;
  expect(ring.suggestedFilename()).toMatch(
    /^gridatlas-izvori-hr-\d{4}-\d{2}-\d{2}-story-\d{4}-\d{2}-\d{2}\.png$/,
  );
  await ring.saveAs(testInfo.outputPath("sources-day-story.png"));

  // and of the latest complete month, on the wide picture
  await kind.selectOption({ label: "Izvori električne energije: zadnji potpuni mjesec" });
  await dialog.getByRole("radio", { name: "Vodoravna" }).check();
  await expect(picture).toHaveAccessibleName(
    /^GridAtlas: izvori električne energije\. Hrvatska · \S+ \d{4}\.: /,
  );
  const monthly = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const month = await monthly;
  expect(month.suggestedFilename()).toMatch(/^gridatlas-izvori-hr-\d{4}-\d{2}-\d{4}-\d{2}-\d{2}\.png$/);
  await month.saveAs(testInfo.outputPath("sources-month.png"));

  await dialog.getByRole("button", { name: "Zatvori" }).click();
  await expect(dialog).toBeHidden();
});

test("a monthly report's link opens the picture of that month", async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  // the report of the latest month says where its picture is
  await page.goto("/izvjestaji/");
  const report = page.locator('main a[href^="/izvjestaji/20"]').first();
  const month = /(\d{4}-\d{2})/.exec((await report.getAttribute("href")) ?? "")?.[1];
  if (!month) throw new Error("no report in the test data");
  await report.click();
  const link = page.getByRole("link", {
    name: "Preuzmi sliku mjeseca za objave: izvori električne energije",
  });
  await expect(link).toHaveAttribute("href", `/?pic=${month}`);
  await link.click();
  const dialog = page.getByRole("dialog", { name: "Slika za dijeljenje" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveAccessibleName(
    /^GridAtlas: izvori električne energije\. Hrvatska · \S+ \d{4}\.: /,
  );
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  expect((await downloading).suggestedFilename()).toContain(`gridatlas-izvori-hr-${month}-`);
  // closed, the share menu opens the ordinary picture again
  await dialog.getByRole("button", { name: "Zatvori" }).click();
  await expect(dialog).toBeHidden();
});

/** Nine gas days of one Croatian facility that is being emptied: 80 % down to 76 % of 5 TWh. */
const GAS_DAYS = Array.from({ length: 9 }, (_, at) => `2026-11-${String(9 + at).padStart(2, "0")}`);
const GAS_STORAGE = {
  version: 1,
  generatedAt: "2026-11-18T08:00:00+00:00",
  source: "GIE AGSI",
  sourceUrl: "https://agsi.gie.eu/",
  attribution: "GIE (Gas Infrastructure Europe), AGSI platform",
  license: "GIE-AGSI-attribution",
  days: GAS_DAYS,
  facilities: [
    {
      id: "31W-PRIMJER-UGSB",
      name: "UGS Primjer",
      operator: "Primjer",
      operatorId: "31X-PRIMJER----A",
      country: "HR",
      lon: 16.5,
      lat: 45.6,
      workingGasTwh: 5,
      status: GAS_DAYS.map(() => "C"),
      fullPercent: GAS_DAYS.map((_, at) => 80 - at * 0.5),
      inStorageTwh: GAS_DAYS.map((_, at) => 4 - at * 0.025),
      injectionGwhPerDay: GAS_DAYS.map(() => 0),
      withdrawalGwhPerDay: GAS_DAYS.map(() => 25),
    },
  ],
  missing: { facilities: [], countries: ["SI"] },
};

test("the learning corner's card opens the picture of the gas in storage", async ({ page }, testInfo) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  // the test data has no storage document (it needs a personal key); hand the page one
  await page.route(/\/local-data\/live\/gasstorage\.json/, (route) => route.fulfill({ json: GAS_STORAGE }));
  await page.goto("/edukacija/");
  await expect(page.getByRole("heading", { name: "Prirodni plin u šest rečenica" })).toBeVisible();
  await page.getByRole("link", { name: "Slika za dijeljenje: zalihe plina" }).click();

  const dialog = page.getByRole("dialog", { name: "Slika za dijeljenje" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Što je na slici")).toHaveValue("gas");
  const picture = dialog.getByRole("img");
  await expect(picture).toHaveAccessibleName(
    "GridAtlas: zalihe plina. Hrvatska · 17. studenoga 2026.: 76 % popunjenost skladišta plina (UGS Primjer, plinski dan 17. studenoga 2026.); 3,8 TWh plina u skladištu (stane 5 TWh); −3,5 p. b. promjena popunjenosti u sedam dana (u postotnim bodovima; 10. studenoga 2026. bilo je 79,5 %). Izvor: GIE AGSI (agsi.gie.eu) · gridatlas.eu",
  );
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("no box");
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^gridatlas-plin-hr-2026-11-17-\d{4}-\d{2}-\d{2}\.png$/);
  await file.saveAs(testInfo.outputPath("gas-card.png"));
  await dialog.getByRole("radio", { name: "Okomita" }).check();
  await expect(picture).toHaveAttribute("height", "1920");
  const story = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  await (await story).saveAs(testInfo.outputPath("gas-card-story.png"));

  // closed, the share menu opens the ordinary picture again
  await dialog.getByRole("button", { name: "Zatvori" }).click();
  await expect(dialog).toBeHidden();
});
