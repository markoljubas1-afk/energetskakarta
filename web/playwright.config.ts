import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
// CI installs Playwright's own Chromium; elsewhere an existing binary can be supplied.
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // the tests stand in for data with page.route, which never sees what a service worker fetches itself;
    // e2e/pwa.spec.ts lets the worker run (Faza 59)
    serviceWorkers: "block",
    locale: "hr-HR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // software WebGL, so the map renders on machines without a GPU
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // e2e/.data is the pipeline's fixture build: npm run e2e:data
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_DATA_BASE_URL: "/local-data/",
      VITE_SITE_URL: `http://localhost:${PORT}`,
      LOCAL_DATA_DIR: "e2e/.data",
      VITE_MAPTILER_KEY: "",
    },
  },
});
