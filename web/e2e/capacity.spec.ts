import { expect, test } from "@playwright/test";

/*
 * The HEP ODS capacity layer (Faza 25). The synthetic e2e bucket has no HEP release, so this checks the
 * wiring and the honest empty state; the bar with a release is covered by CapacityBar.test.tsx.
 */
test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the capacity layer opens its bar, which says so while HEP ODS has no published release", async ({
  page,
}) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.goto("/?l=lines,substations,capacity");
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  const bar = page.getByRole("region", { name: "Slobodni kapacitet (HEP ODS)" });
  await expect(bar).toContainText("Podaci HEP ODS-a o slobodnom kapacitetu još nisu objavljeni.");
});
