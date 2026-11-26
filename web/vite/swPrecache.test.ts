import { describe, expect, it } from "vitest";

import { importsAChunk, precacheList, type BundleItem } from "./swPrecache";

const chunk = (
  fileName: string,
  extra: Partial<Extract<BundleItem, { type: "chunk" }>> = {},
): BundleItem => ({
  type: "chunk",
  fileName,
  name: fileName,
  isEntry: false,
  imports: [],
  facadeModuleId: null,
  ...extra,
});
const asset = (fileName: string): BundleItem => ({ type: "asset", fileName });

describe("what the service worker keeps at install (Faza 59)", () => {
  it("is the page's entry with what it imports, the map's chunk and worker, their styles and the fonts", () => {
    const bundle: Record<string, BundleItem> = {
      "assets/main-a1.js": chunk("assets/main-a1.js", {
        name: "main",
        isEntry: true,
        imports: ["assets/react-b2.js"],
        viteMetadata: { importedCss: new Set(["assets/main-c3.css"]) },
      }),
      "assets/react-b2.js": chunk("assets/react-b2.js"),
      "assets/MapView-d4.js": chunk("assets/MapView-d4.js", {
        facadeModuleId: "/repo/web/src/map/MapView.tsx",
        imports: ["assets/maplibre-e5.js"],
        viteMetadata: { importedCss: new Set(["assets/MapView-f6.css"]) },
      }),
      "assets/maplibre-e5.js": chunk("assets/maplibre-e5.js"),
      "assets/EnergyView-g7.js": chunk("assets/EnergyView-g7.js", {
        facadeModuleId: "/repo/web/src/energy/EnergyView.tsx",
      }),
      "assets/ibm-plex-sans-latin-400-normal-h8.woff2": asset(
        "assets/ibm-plex-sans-latin-400-normal-h8.woff2",
      ),
      "assets/main-a1.js.map": asset("assets/main-a1.js.map"),
      "assets/maplibre-gl-worker-i9.js": asset("assets/maplibre-gl-worker-i9.js"),
      "assets/maplibre-gl-worker-i9.js.map": asset("assets/maplibre-gl-worker-i9.js.map"),
      "sw.js": chunk("sw.js", { name: "sw", isEntry: true }),
      "learn-live.js": chunk("learn-live.js", { name: "learn-live", isEntry: true }),
    };
    expect(precacheList(bundle).sort()).toEqual(
      [
        "/assets/main-a1.js",
        "/assets/react-b2.js",
        "/assets/main-c3.css",
        "/assets/MapView-d4.js",
        "/assets/maplibre-e5.js",
        "/assets/MapView-f6.css",
        "/assets/ibm-plex-sans-latin-400-normal-h8.woff2",
        "/assets/maplibre-gl-worker-i9.js",
      ].sort(),
    );
  });
});

describe("the worker stands alone (Faza 59)", () => {
  it("is caught when the build made it import a chunk shared with the page", () => {
    expect(importsAChunk('import{t as e}from"./assets/dataSource-x.js";function t(){}')).toBe(true);
    expect(importsAChunk('var a=1;import*as b from"./c.js"')).toBe(true);
    expect(
      importsAChunk("function t(e){return e.method!==`GET`}var r=self;r.addEventListener(`install`,()=>{})"),
    ).toBe(false);
  });
});
