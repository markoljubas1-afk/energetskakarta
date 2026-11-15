/**
 * A button with a menu that opens in the browser's top layer (Popover API), so no scrolling panel can cut it
 * off (Faza 31: the download, map-share and chart-share menus inside the bottom dock were clipped and could not
 * be clicked). The browser closes it on Escape, on a click outside and when another menu opens, and returns
 * focus to the button. The menu is placed next to its button from script, on the preferred side when it fits
 * and on the other side when it does not, always inside the screen.
 */
import { useId, useRef, type ReactNode } from "react";

import styles from "./PopoverMenu.module.css";

/** Where the menu prefers to open. */
export type Placement = "above" | "below";

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const GAP_PX = 6;
const EDGE_PX = 8;

/** The menu's top-left corner in the viewport: beside the button, flipped or clamped to stay on screen. */
export function placeMenu(
  button: Box,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: Placement,
): { top: number; left: number } {
  const roomAbove = button.top - GAP_PX - EDGE_PX;
  const roomBelow = viewport.height - button.bottom - GAP_PX - EDGE_PX;
  const preferredFits = placement === "above" ? roomAbove >= menu.height : roomBelow >= menu.height;
  const above = preferredFits ? placement === "above" : roomAbove > roomBelow;
  const top = above ? button.top - GAP_PX - menu.height : button.bottom + GAP_PX;
  // starts under the button's left edge, or ends at its right edge when that keeps it on screen
  const left = button.left + menu.width <= viewport.width - EDGE_PX ? button.left : button.right - menu.width;
  const clamp = (value: number, size: number, room: number): number =>
    Math.min(Math.max(EDGE_PX, value), Math.max(EDGE_PX, room - EDGE_PX - size));
  return {
    top: clamp(top, menu.height, viewport.height),
    left: clamp(left, menu.width, viewport.width),
  };
}

interface Props {
  /** the button's content (icon and label) */
  trigger: ReactNode;
  /** the button's accessible name, for when its visible label is hidden (phones) or too short */
  label: string;
  /** CSS-module class names, which TypeScript sees as possibly undefined */
  triggerClassName: string | undefined;
  menuClassName: string | undefined;
  placement?: Placement;
  children: ReactNode;
}

export function PopoverMenu({
  trigger,
  label,
  triggerClassName,
  menuClassName,
  placement = "below",
  children,
}: Props) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // the browser has just opened or closed the menu: place it while it is still invisible (CSS), then show it
  const onToggle = (): void => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    if (!menu.matches(":popover-open")) {
      delete menu.dataset.placed;
      return;
    }
    const size = menu.getBoundingClientRect();
    const { top, left } = placeMenu(
      button.getBoundingClientRect(),
      { width: size.width, height: size.height },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    );
    menu.style.top = `${String(top)}px`;
    menu.style.left = `${String(left)}px`;
    menu.dataset.placed = "";
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        popoverTarget={id}
        aria-label={label}
        aria-haspopup="true"
      >
        {trigger}
      </button>
      <div
        ref={menuRef}
        id={id}
        popover="auto"
        className={[styles.popover, menuClassName].filter(Boolean).join(" ")}
        onToggle={onToggle}
      >
        {children}
      </div>
    </>
  );
}
