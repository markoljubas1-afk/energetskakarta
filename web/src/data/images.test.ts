import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../test/render";
import { ImageIndexSchema, loadImages, photoOf, type ImageIndex } from "./images";

const INDEX: ImageIndex = {
  version: 1,
  generatedAt: "2026-11-16T12:00:00+00:00",
  source: "Wikimedia Commons",
  width: 640,
  images: {
    "osm:way/1": {
      key: "images/0123456789abcdef0123.jpg",
      width: 640,
      height: 480,
      author: "Ana & Co",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      page: "https://commons.wikimedia.org/wiki/File:HE_Primjer.jpg",
    },
  },
};
const BASE = new URL("https://podaci.test/");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("photographs", () => {
  it("is what the pipeline writes, and refuses a copy that is not in our images folder", () => {
    expect(ImageIndexSchema.parse(INDEX)).toEqual(INDEX);
    const elsewhere = {
      ...INDEX,
      images: { x: { ...INDEX.images["osm:way/1"], key: "https://upload.wikimedia.org/a.jpg" } },
    };
    expect(() => ImageIndexSchema.parse(elsewhere)).toThrow();
  });

  it("gives an asset's photograph at our own address, with its credit, or nothing", () => {
    expect(photoOf(INDEX, BASE, "osm:way/1")).toEqual({
      url: "https://podaci.test/images/0123456789abcdef0123.jpg",
      width: 640,
      height: 480,
      author: "Ana & Co",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      page: "https://commons.wikimedia.org/wiki/File:HE_Primjer.jpg",
    });
    expect(photoOf(INDEX, BASE, "osm:way/2")).toBeNull();
  });

  it("treats a release without photographs as that, and a broken answer as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    expect(await loadImages(BASE, new AbortController().signal)).toEqual({ kind: "none" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(INDEX)));
    expect(await loadImages(BASE, new AbortController().signal)).toEqual({ kind: "ready", index: INDEX });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(loadImages(BASE, new AbortController().signal)).rejects.toThrow("HTTP 500");
  });
});
