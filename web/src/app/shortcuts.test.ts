import { describe, expect, it } from "vitest";

import { KEY_OF, routeShortcut, SHORTCUTS } from "./shortcuts";

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
