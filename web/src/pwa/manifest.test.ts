import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseState } from "../state/url";

interface Manifest {
  id: string;
  display: string;
  start_url: string;
  icons: { src: string; sizes: string }[];
  shortcuts: { name: string; url: string; icons?: unknown[] }[];
}

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../public/site.webmanifest"), "utf8"),
) as Manifest;

describe("the web app manifest (Faza 59)", () => {
  it("installs as an app of its own, in its own window", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.id).toBe("/");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
  });

  it("offers shortcuts to the map, the generation over time and the live flows, each a link the app reads", () => {
    expect(manifest.shortcuts.map((shortcut) => shortcut.name)).toEqual([
      "Karta",
      "Proizvodnja kroz vrijeme",
      "Tokovi i cijene uživo",
    ]);
    const states = manifest.shortcuts.map((shortcut) =>
      parseState(new URL(shortcut.url, "https://x.test").search, "hr"),
    );
    expect(states.map((state) => [state.page, state.live])).toEqual([
      ["map", false],
      ["energy", false],
      ["map", true],
    ]);
  });
});
