import { expect, test } from "@playwright/test";

/**
 * "?pic=solarhead" opens the pictures on solar electricity per inhabitant (Faza 46). The test data has no
 * such document, so the page is handed one with Eurostat's figures of 2026-11-19 for two countries.
 */
const year = (at: number, gwh: number, people: number, kwhPerPerson: number) => ({
  year: at,
  gwh,
  people,
  kwhPerPerson,
  generationFlag: null,
  populationFlag: null,
});

const SOLAR = {
  version: 1,
  source: "Eurostat",
  license: "CC-BY-4.0",
  generation: {
    dataset: "nrg_bal_peh",
    url: "https://ec.europa.eu/eurostat/databrowser/view/nrg_bal_peh/default/table",
    updated: "2026-06-02T23:00:00+02:00",
  },
  population: {
    dataset: "demo_gind",
    url: "https://ec.europa.eu/eurostat/databrowser/view/demo_gind/default/table",
    updated: "2026-10-27T23:00:00+01:00",
  },
  retrievedAt: "2026-11-19T20:00:00+00:00",
  year: 2024,
  countries: {
    HR: [year(2023, 413.1, 3856431, 107.1), year(2024, 820, 3868159, 212)],
    HU: [year(2023, 6925, 9592186, 721.9), year(2024, 9200, 9562065, 962.1)],
  },
  flagLabels: {},
};

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the picture of solar electricity per inhabitant opens from its link and can be saved", async ({
  page,
}, testInfo) => {
  await page.route("https://api.maptiler.com/**", (route) => route.abort());
  await page.route(/\/local-data\/eurostat\/solarcapita\.json/, (route) => route.fulfill({ json: SOLAR }));
  await page.goto("/?pic=solarhead");
  const dialog = page.getByRole("dialog", { name: "Slika za dijeljenje" });
  await expect(dialog.getByLabel("Što je na slici")).toHaveValue("solarhead");
  const picture = dialog.getByRole("img");
  await expect(picture).toHaveAccessibleName(
    "GridAtlas: Sunčana struja po stanovniku. Hrvatska · 2024.: 212 kWh sunčane struje po stanovniku (820 GWh iz fotonaponskih elektrana na 3,87 mil. stanovnika); 2. od 2 mjesto u regiji (prva: Mađarska, 962 kWh); +98 % u odnosu na 2023. (tada 107 kWh po stanovniku). Izračun GridAtlasa iz podataka Eurostata (nrg_bal_peh, demo_gind) · gridatlas.eu",
  );
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Preuzmi sliku (PNG)" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^gridatlas-sunce-po-stanovniku-hr-2024-\d{4}-\d{2}-\d{2}\.png$/);
  await file.saveAs(testInfo.outputPath("solar-head-card.png"));
  // the other country of the document
  await dialog.getByLabel("Zemlja").selectOption("HU");
  await expect(picture).toHaveAccessibleName(
    /Mađarska · 2024\.: 962 kWh .* 1\. od 2 mjesto u regiji \(najviše u regiji\)/,
  );
});
