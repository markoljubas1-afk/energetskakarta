/**
 * Keyboard shortcuts for the map page. Single keys, no modifiers, never while typing: the same
 * conventions as GitHub or Gmail, so nobody has to learn them. A reader who talks to the page (speech
 * input types letters) can turn the character keys off in the shortcuts list (Faza 57, WCAG 2.1.4).
 */
import { useEffect } from "react";

export const SHORTCUTS = ["search", "escape", "help", "theme", "live"] as const;
export type Shortcut = (typeof SHORTCUTS)[number];

/** Key → action; listed in the help dialog in this order. */
export const KEY_OF: Record<Shortcut, string> = {
  search: "/",
  escape: "Escape",
  help: "?",
  theme: "t",
  live: "l",
};

interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const STORAGE_KEY = "energymap-shortcuts";
// the choice for this visit when the browser cannot store it
let remembered: boolean | null = null;

/** Whether the character keys (/ ? t l) are shortcuts; Escape always is. */
export function singleKeysOn(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return remembered ?? true; // storage unavailable (privacy mode): this visit only
  }
}

export function setSingleKeys(on: boolean): void {
  remembered = on;
  try {
    if (on) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, "off");
  } catch {
    // not stored: `remembered` keeps it for this visit
  }
}

/**
 * The action a key press asks for, or null when it is nothing of ours. Pure, for tests. With `singleKeys`
 * off only Escape is left: it is not a character a speech or switch user could type by accident.
 */
export function routeShortcut(event: KeyLike, singleKeys = true): Shortcut | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  // a key pressed inside a field belongs to that field (Escape included: the search box clears with it)
  if (isTyping(event.target)) return null;
  const match = SHORTCUTS.find((action) => KEY_OF[action] === event.key) ?? null;
  return match === "escape" || singleKeys ? match : null;
}

/** Listen on the document; `handlers` may leave an action out, in which case the key does nothing. */
export function useShortcuts(handlers: Partial<Record<Shortcut, () => void>>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // a modal dialog owns the keyboard while it is open (Escape closes it natively)
      if (document.querySelector("dialog[open]")) return;
      const action = routeShortcut(event, singleKeysOn());
      if (!action) return;
      const handler = handlers[action];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [handlers]);
}
