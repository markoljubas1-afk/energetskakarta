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

test("the very first visit already opens without a network, with the last data seen, and says so", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  // installed: the worker has kept the app's code, the map's code and the data index (no second visit online)
  const kept = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const assets = await caches.open("gridatlas-assets");
    const files = (await assets.keys()).map((request) => new URL(request.url).pathname);
    return { state: registration.active?.state, files };
  });
  expect(kept.state).toBe("activated");
  const entry = await page.evaluate(
    () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/main-"]')?.src ?? "",
  );
  expect(kept.files).toContain(new URL(entry).pathname);
  expect(kept.files.some((file) => file.includes("/MapView-"))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Nema veze s mrežom" })).toBeVisible();
  // the header and the data's date come from the kept copies
  await expect(page.getByRole("heading", { level: 1, name: "GridAtlas" })).toBeVisible();
  await expect(page.locator("[data-data-version]")).toContainText("Karta od");
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Nema veze s mrežom" })).toBeHidden();
});

/*
 * The map's tiles (Faza 59-B). Playwright cannot take the network away from a service worker's own requests
 * (setOffline and route do not reach them), so this checks what makes the map work offline: once kept, a piece
 * is served from the cache, before and without the network.
 */
test("the map's tile pieces are kept and then read from the cache, not the network", async ({ page }) => {
  // the fixture's lines are around Zagreb (map.spec.ts)
  await page.goto("/?v=45.55,15.95,9");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // the worker took the page over after it loaded: one look with it in charge keeps the pieces in view
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const pieces = await page.evaluate(
    async () => (await (await caches.open("gridatlas-tiles")).keys()).length,
  );
  expect(pieces).toBeGreaterThan(0);

  const kept: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes(".pmtiles") && response.headers()["x-gridatlas-kept"] === "1")
      kept.push(response.url());
  });
  await page.reload();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  expect(kept.some((url) => url.includes("grid.pmtiles"))).toBe(true);
});
