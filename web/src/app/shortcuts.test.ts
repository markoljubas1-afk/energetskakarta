import { afterEach, describe, expect, it } from "vitest";

import { KEY_OF, routeShortcut, setSingleKeys, SHORTCUTS, singleKeysOn } from "./shortcuts";

const press = (key: string, target: EventTarget | null = document.body, mods = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target,
  ...mods,
});

describe("routeShortcut", () => {
  it("maps every listed key to its action and nothing else", () => {
    for (const action of SHORTCUTS) expect(routeShortcut(press(KEY_OF[action]))).toBe(action);
    expect(routeShortcut(press("x"))).toBeNull();
    expect(routeShortcut(press("Enter"))).toBeNull();
  });

  it("stays out of the way of the browser's own shortcuts", () => {
    expect(routeShortcut(press("l", document.body, { ctrlKey: true }))).toBeNull();
    expect(routeShortcut(press("t", document.body, { metaKey: true }))).toBeNull();
    expect(routeShortcut(press("/", document.body, { altKey: true }))).toBeNull();
  });

  it("never fires while someone is typing, Escape included", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    for (const field of [input, area, select, editable]) {
      expect(routeShortcut(press("/", field))).toBeNull();
      expect(routeShortcut(press("Escape", field))).toBeNull();
    }
    // a button is not a field: shortcuts work with one focused
    expect(routeShortcut(press("?", document.createElement("button")))).toBe("help");
  });
});

describe("single-key shortcuts can be turned off (Faza 57, WCAG 2.1.4)", () => {
  afterEach(() => {
    setSingleKeys(true);
    window.localStorage.clear();
  });

  it("are on unless the reader turned them off, and the choice is remembered", () => {
    expect(singleKeysOn()).toBe(true);
    setSingleKeys(false);
    expect(singleKeysOn()).toBe(false);
    expect(window.localStorage.getItem("energymap-shortcuts")).toBe("off");
    setSingleKeys(true);
    expect(singleKeysOn()).toBe(true);
  });

  it("when off, only Escape still works: it is not a character key and closes what is open", () => {
    for (const action of SHORTCUTS) {
      expect(routeShortcut(press(KEY_OF[action]), false)).toBe(action === "escape" ? "escape" : null);
    }
  });
});
