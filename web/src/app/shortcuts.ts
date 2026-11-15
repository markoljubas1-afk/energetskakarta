/**
 * Keyboard shortcuts for the map page. Single keys, no modifiers, never while typing: the same
 * conventions as GitHub or Gmail, so nobody has to learn them.
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

/** The action a key press asks for, or null when it is nothing of ours. Pure, for tests. */
export function routeShortcut(event: KeyLike): Shortcut | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  // a key pressed inside a field belongs to that field (Escape included: the search box clears with it)
  if (isTyping(event.target)) return null;
  const match = SHORTCUTS.find((action) => KEY_OF[action] === event.key);
  return match ?? null;
}

/** Listen on the document; `handlers` may leave an action out, in which case the key does nothing. */
export function useShortcuts(handlers: Partial<Record<Shortcut, () => void>>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // a modal dialog owns the keyboard while it is open (Escape closes it natively)
      if (document.querySelector("dialog[open]")) return;
      const action = routeShortcut(event);
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
