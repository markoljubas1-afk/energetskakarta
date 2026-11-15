import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

// jsdom has no matchMedia; tests run as a light, wide screen. A plain function (not vi.fn) so that
// `restoreMocks` cannot reset it between tests.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList,
});

// Tests are automation: like Playwright's browsers they get the map without the first-visit intro
// (app/intro.ts). The intro's own tests switch this off.
Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => true });
