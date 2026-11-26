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
