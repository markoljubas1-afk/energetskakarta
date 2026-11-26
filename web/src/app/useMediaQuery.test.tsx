import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useMediaQuery } from "./useMediaQuery";

const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
afterEach(() => {
  if (original) Object.defineProperty(window, "matchMedia", original);
});

/** One media query whose answer the test changes, as the browser does when the window is resized. */
function fakeQuery(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    matches: initial,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
  };
  window.matchMedia = () => list as unknown as MediaQueryList;
  return {
    set(matches: boolean) {
      list.matches = matches;
      listeners.forEach((listener) => {
        listener({ matches } as MediaQueryListEvent);
      });
    },
    listeners,
  };
}

describe("useMediaQuery", () => {
  it("answers now and follows the window as it changes", () => {
    const query = fakeQuery(false);
    const { result, unmount } = renderHook(() => useMediaQuery("(max-width: 1000px)"));
    expect(result.current).toBe(false);
    act(() => {
      query.set(true);
    });
    expect(result.current).toBe(true);
    unmount();
    expect(query.listeners.size).toBe(0);
  });
});
