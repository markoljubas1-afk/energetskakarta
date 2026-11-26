import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { setSingleKeys, singleKeysOn } from "../app/shortcuts";
import { renderWithI18n } from "../test/render";
import { ShortcutsHelp } from "./ShortcutsHelp";

beforeAll(() => {
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  setSingleKeys(true);
  window.localStorage.clear();
});

describe("the shortcuts list (Faza 57)", () => {
  it("turns the single-key shortcuts off and on again", () => {
    renderWithI18n(<ShortcutsHelp open onClose={() => undefined} />);
    const toggle = screen.getByRole("checkbox", { name: /Prečaci jednom tipkom/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(singleKeysOn()).toBe(false);
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(singleKeysOn()).toBe(true);
  });
});
