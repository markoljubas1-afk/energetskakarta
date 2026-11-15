import { describe, expect, it } from "vitest";

import { snapshotFileName, wrapText } from "./snapshot";

const byLength = (s: string): number => s.length;

describe("wrapText", () => {
  it("fills each line as far as the width allows and never splits a word", () => {
    expect(wrapText("© OpenStreetMap contributors (ODbL) | Natural Earth", 20, byLength)).toEqual([
      "© OpenStreetMap",
      "contributors (ODbL)",
      "| Natural Earth",
    ]);
  });

  it("keeps a word that is wider than the line on a line of its own", () => {
    expect(wrapText("a extraordinarily b", 5, byLength)).toEqual(["a", "extraordinarily", "b"]);
  });

  it("ignores runs of whitespace and returns nothing for empty text", () => {
    expect(wrapText("  a   b  ", 100, byLength)).toEqual(["a b"]);
    expect(wrapText("   ", 100, byLength)).toEqual([]);
  });
});

describe("snapshotFileName", () => {
  it("is sortable and safe for every file system", () => {
    const name = snapshotFileName(new Date(2026, 8, 19, 14, 5));
    expect(name).toBe("energetska-karta-2026-09-19-1405.png");
    expect(name).toMatch(/^[a-z0-9-]+\.png$/);
  });
});
