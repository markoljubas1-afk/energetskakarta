import { describe, expect, it } from "vitest";

import { ConfigError, readConfig } from "./config";

describe("readConfig", () => {
  it("resolves a relative data URL against the page and adds the trailing slash", () => {
    const config = readConfig({ VITE_DATA_BASE_URL: "/local-data" }, "https://karta.test/app?x=1");
    expect(config.dataBaseUrl.toString()).toBe("https://karta.test/local-data/");
    expect(config.maptilerKey).toBeNull();
  });

  it("keeps an absolute data URL and trims the key", () => {
    const config = readConfig(
      { VITE_DATA_BASE_URL: "https://podaci.test/", VITE_MAPTILER_KEY: "  abc  " },
      "https://karta.test/",
    );
    expect(config.dataBaseUrl.toString()).toBe("https://podaci.test/");
    expect(config.maptilerKey).toBe("abc");
  });

  it("treats an empty key as no key", () => {
    expect(
      readConfig({ VITE_DATA_BASE_URL: "/d/", VITE_MAPTILER_KEY: "" }, "https://k.test/").maptilerKey,
    ).toBeNull();
  });

  it("switches the support page on only when asked to (Faza 24)", () => {
    expect(readConfig({ VITE_DATA_BASE_URL: "/d/" }, "https://k.test/").support).toBe(false);
    expect(readConfig({ VITE_DATA_BASE_URL: "/d/", VITE_SUPPORT: "1" }, "https://k.test/").support).toBe(
      true,
    );
  });

  it("fails clearly without a data URL", () => {
    expect(() => readConfig({}, "https://k.test/")).toThrow(ConfigError);
    expect(() => readConfig({ VITE_DATA_BASE_URL: "" }, "https://k.test/")).toThrow(/empty/);
  });
});
