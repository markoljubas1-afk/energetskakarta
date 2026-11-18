import { expect, test } from "@playwright/test";

/** The panel of filters folds away on a computer, so that it is not in the way of the map. */

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the panel of filters folds away and comes back, and the choice is kept", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const panel = page.locator("#settings-panel");
  const hide = page.getByRole("button", { name: "Sakrij filtre i pregled" });
  const show = page.getByRole("button", { name: "Prikaži filtre i pregled" });

  // a phone has its own sheet and button: no handle there
  if (isMobile) {
    await expect(hide).toBeHidden();
    return;
  }

  await expect(panel).toBeVisible();
  const status = page.getByRole("button", { name: "Podijeli", exact: true });
  const before = await status.boundingBox();
  await hide.click();
  await expect(panel).toBeHidden();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  // the bars along the bottom take the room the panel gave up
  const after = await status.boundingBox();
  if (!before || !after) throw new Error("no status bar");
  expect(after.x).toBeLessThan(before.x - 300);
  await page.screenshot({ path: testInfo.outputPath("folded.png") });

  // the next visit finds the panel as it was left
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(panel).toBeHidden();

  await show.click();
  await expect(panel).toBeVisible();
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: testInfo.outputPath("open.png") });
  // the handle lies beside the panel, not over it
  const handle = await hide.boundingBox();
  const side = await panel.boundingBox();
  if (!handle || !side) throw new Error("no box");
  expect(handle.x).toBeGreaterThanOrEqual(side.x + side.width);
});
