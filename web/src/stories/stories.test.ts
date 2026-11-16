import { describe, expect, it } from "vitest";

import { LAYER_KEYS, SCOPE_COUNTRIES, TECHNOLOGIES, VOLTAGE_CLASSES } from "../domain";
import { HOME_BOUNDS } from "../map/firstView";
import { defaultState, LANGS, parseState, serializeState } from "../state/url";
import { applyStep, isStoryKey, leave, remember, sameBefore, STORIES, STORY_KEYS } from "./stories";

describe("guided stories", () => {
  it("has every story the address knows, each with a handful of steps in both languages", () => {
    expect(Object.keys(STORIES)).toEqual([...STORY_KEYS]);
    for (const key of STORY_KEYS) {
      const story = STORIES[key];
      expect(story.key).toBe(key);
      expect(story.steps.length).toBeGreaterThanOrEqual(4);
      expect(story.steps.length).toBeLessThanOrEqual(6);
      // the card keys its progress dots by the Croatian title
      expect(new Set(story.steps.map((step) => step.title.hr)).size).toBe(story.steps.length);
      for (const lang of LANGS) {
        expect(story.title[lang].length).toBeGreaterThan(5);
        expect(story.summary[lang].length).toBeGreaterThan(20);
        for (const step of story.steps) {
          expect(step.title[lang].length, `${key}: ${step.title.hr}`).toBeGreaterThanOrEqual(3);
          // two or three sentences: enough to say something, short enough to read while the map moves
          expect(step.text[lang].length, `${key}: ${step.title.hr}`).toBeGreaterThan(60);
          expect(step.text[lang].length, `${key}: ${step.title.hr}`).toBeLessThan(330);
        }
      }
    }
  });

  it("only shows what the map has: known layers, countries, technologies, voltages, and places in the region", () => {
    const [west, south, east, north] = [6, 35, 23.5, 49.5];
    expect(HOME_BOUNDS[0]).toBeGreaterThan(west);
    for (const story of Object.values(STORIES)) {
      for (const step of story.steps) {
        const where = `${story.key}: ${step.title.hr}`;
        expect(step.layers.length, where).toBeGreaterThan(0);
        for (const layer of step.layers) expect(LAYER_KEYS, where).toContain(layer);
        for (const country of step.countries ?? []) expect(SCOPE_COUNTRIES, where).toContain(country);
        if (step.spotlight?.kind === "technology")
          expect(TECHNOLOGIES, where).toContain(step.spotlight.value);
        if (step.spotlight?.kind === "voltage")
          expect(VOLTAGE_CLASSES, where).toContain(step.spotlight.value);
        // a technology can only be lit where plants are drawn, a voltage where lines are
        if (step.spotlight?.kind === "technology") expect(step.layers, where).toContain("plants");
        if (step.spotlight?.kind === "voltage") expect(step.layers, where).toContain("lines");
        expect(step.view.lng, where).toBeGreaterThan(west);
        expect(step.view.lng, where).toBeLessThan(east);
        expect(step.view.lat, where).toBeGreaterThan(south);
        expect(step.view.lat, where).toBeLessThan(north);
        expect(step.view.zoom, where).toBeGreaterThanOrEqual(5);
        expect(step.view.zoom, where).toBeLessThanOrEqual(12);
      }
    }
  });

  it("applies a step as a state the address can hold, and gives the map back when it ends", () => {
    const mine = parseState("?l=lines,plants,cities&c=HR,SI&y=1990&sel=osm:way/1&story=granice", "hr");
    const before = remember({ ...mine, story: null });
    const step = STORIES.granice.steps[3];
    if (!step) throw new Error("the story has a fourth step");
    const shown = applyStep(mine, step);
    expect([...shown.layers]).toEqual(["lines"]);
    expect(shown.live).toBe(true);
    expect(shown.countries.size).toBe(0);
    expect(shown.selected).toBeNull();
    expect(shown.year).toBeNull();
    expect(shown.story).toBe("granice");
    // what a step shows survives a trip through the address bar
    const again = parseState(serializeState(shown, "hr"), "hr");
    expect([...again.layers]).toEqual([...shown.layers]);
    expect(again.live).toBe(true);
    expect(again.story).toBe("granice");

    const after = leave(shown, before);
    expect(after.story).toBeNull();
    expect([...after.layers]).toEqual(["lines", "plants", "cities"]);
    expect([...after.countries]).toEqual(["HR", "SI"]);
    expect(after.year).toBe(1990);
    expect(after.live).toBe(false);
    expect(sameBefore(before, after)).toBe(true);
    expect(sameBefore(before, shown)).toBe(false);
  });

  it("reads the story from the address and ignores one it does not know", () => {
    expect(parseState("?story=put-struje", "hr").story).toBe("put-struje");
    expect(parseState("?story=nepoznata", "hr").story).toBeNull();
    expect(defaultState("hr").story).toBeNull();
    expect(serializeState(defaultState("hr"), "hr")).toBe("");
    expect(isStoryKey("granice")).toBe(true);
    expect(isStoryKey(null)).toBe(false);
  });

  it("gives a point of light only to a story with a route, and lets it travel exactly once", () => {
    for (const story of Object.values(STORIES)) {
      const modes = story.steps.flatMap((step) => (step.traveller ? [step.traveller] : []));
      if (story.route === undefined) {
        expect(modes, story.key).toEqual([]);
        continue;
      }
      // it waits, travels, and has arrived, in that order; the journey itself runs along the lines
      expect(modes, story.key).toEqual(["start", "travel", "end"]);
      const travelling = story.steps.find((step) => step.traveller === "travel");
      expect(travelling?.layers, story.key).toContain("lines");
    }
    expect(STORIES.kilovatsat.route).toBe("dalmacija-zagreb");
  });
});
