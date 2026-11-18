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
  await page.getByRole("button", { name: "Slika dana: tri brojke za dijeljenje" }).click();

  const dialog = page.getByRole("dialog", { name: "GridAtlas: energetska slika dana" });
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

  await dialog.getByRole("button", { name: "Zatvori" }).click();
  await expect(dialog).toBeHidden();
});
