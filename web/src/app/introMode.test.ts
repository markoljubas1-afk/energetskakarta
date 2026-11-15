import { describe, expect, it } from "vitest";

import { introMode, linksSomewhere, type IntroEnvironment } from "./introMode";

const firstVisit: IntroEnvironment = {
  search: "",
  lang: "hr",
  seen: false,
  reducedMotion: false,
  automated: false,
};

describe("when the intro plays", () => {
  it("plays in full on a first visit to the bare address", () => {
    expect(introMode(firstVisit)).toBe("full");
    expect(introMode({ ...firstVisit, lang: "en" })).toBe("full");
  });

  it("is only the title, fading into the map, for a reader who asked for reduced motion", () => {
    expect(introMode({ ...firstVisit, reducedMotion: true })).toBe("still");
  });

  it("does not play again, nor for automation", () => {
    expect(introMode({ ...firstVisit, seen: true })).toBe("none");
    expect(introMode({ ...firstVisit, automated: true })).toBe("none");
  });

  it("never stands between a shared link and what it shares", () => {
    for (const search of [
      "?sel=osm%3Away%2F123",
      "?v=45.8,16.0,9.00",
      "?l=lines,cities",
      "?live=1",
      "?embed=1",
      "?p=energy",
      "?kv=380%2B",
    ]) {
      expect(linksSomewhere(search, "hr")).toBe(true);
      expect(introMode({ ...firstVisit, search })).toBe("none");
    }
  });

  it("ignores parameters the map does not know, such as a campaign's", () => {
    expect(linksSomewhere("?utm_source=newsletter&utm_medium=email", "hr")).toBe(false);
    expect(introMode({ ...firstVisit, search: "?utm_source=newsletter" })).toBe("full");
  });
});
