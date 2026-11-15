/**
 * The Popover API for jsdom, which hides `[popover]` elements but cannot open them (no showPopover, no
 * `:popover-open`, no `popovertarget`). Only what the app relies on (share/PopoverMenu.tsx): a button opens
 * and closes its menu, an open "auto" menu closes on Escape, on a click outside and when another opens, and
 * the menu hears `toggle`. Placement in the top layer is the browser's work and is covered by e2e.
 */
const open = new Set<HTMLElement>();

function setOpen(element: HTMLElement, next: boolean): void {
  if (open.has(element) === next) return;
  if (next) {
    for (const other of [...open])
      if (other.popover === "auto" && !other.contains(element)) setOpen(other, false);
    open.add(element);
    element.style.display = "block"; // jsdom's own stylesheet keeps every popover at display: none
  } else {
    open.delete(element);
    element.style.removeProperty("display");
  }
  element.dispatchEvent(new Event("toggle"));
}

export function installPopover(): void {
  const proto = HTMLElement.prototype;
  proto.showPopover = function showPopover(this: HTMLElement): void {
    setOpen(this, true);
  };
  proto.hidePopover = function hidePopover(this: HTMLElement): void {
    setOpen(this, false);
  };
  proto.togglePopover = function togglePopover(this: HTMLElement): boolean {
    setOpen(this, !open.has(this));
    return open.has(this);
  };

  // defineProperty, because `matches` is declared with type-predicate overloads a plain function cannot satisfy
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "matches");
  Object.defineProperty(Element.prototype, "matches", {
    configurable: true,
    writable: true,
    value: function patched(this: Element, selector: string): boolean {
      if (selector === ":popover-open") return this instanceof HTMLElement && open.has(this);
      return (original?.value as (this: Element, selector: string) => boolean).call(this, selector);
    },
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("button[popovertarget]");
    const id = button?.getAttribute("popovertarget");
    const menu = id ? document.getElementById(id) : null;
    if (menu) {
      menu.togglePopover();
      return;
    }
    // light dismiss: a click outside every open menu closes them
    for (const element of [...open]) {
      if (element.popover === "auto" && !(target && element.contains(target))) setOpen(element, false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const element of [...open]) if (element.popover === "auto") setOpen(element, false);
  });
}

/** Menus of an unmounted test must not stay "open" for the next one. */
export function resetPopovers(): void {
  open.clear();
}
