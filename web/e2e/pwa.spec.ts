import { expect, test } from "@playwright/test";

/* The site as an installed app (Faza 59): the service worker keeps the last release and data seen. */
test.use({ serviceWorkers: "allow" });

test.beforeEach(async ({ page }) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
});

test("the manifest makes it an app of its own window, with shortcuts", async ({ request }) => {
  const manifest = (await (await request.get("/site.webmanifest")).json()) as {
    display: string;
    shortcuts: unknown[];
  };
  expect(manifest.display).toBe("standalone");
  expect(manifest.shortcuts).toHaveLength(3);
});

test("without a network the map opens with the last data seen, and says so", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  // the worker takes over this page once it is active; one more visit lets it keep the data the map reads
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Nema veze s mrežom" })).toBeVisible();
  // the header and the data's date come from the kept copies
  await expect(page.locator("[data-data-version]")).toContainText("Karta od");
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Nema veze s mrežom" })).toBeHidden();
});
