import { describe, expect, it } from "vitest";

import { pictureLayout } from "./chartImage";
import { fileStem } from "./download";

describe("chart pictures", () => {
  it("leave room for every line of credits and the link, at the screen's pixel ratio", () => {
    const one = pictureLayout(1, 1);
    const three = pictureLayout(1, 3);
    expect(three.footer - one.footer).toBeCloseTo(2 * 10.5 * 1.4);
    expect(pictureLayout(2, 1).header).toBeCloseTo(2 * one.header);
  });

  it("leave room for a note above the credits, such as Croatia's half of Krško", () => {
    const plain = pictureLayout(1, 1);
    // a gap, then each line of the note at the credits' size
    expect(pictureLayout(1, 1, 2).footer - plain.footer).toBeCloseTo(6 + 2 * 10.5 * 1.4);
    expect(pictureLayout(2, 1, 2).footer).toBeCloseTo(2 * pictureLayout(1, 1, 2).footer);
    expect(pictureLayout(1, 1, 0)).toEqual(plain);
  });

  it("are named in ASCII with the date", () => {
    expect(fileStem("Isti mjesec kroz godine · Sunce", new Date(2026, 10, 15))).toBe(
      "isti-mjesec-kroz-godine-sunce-2026-11-15",
    );
  });
});
