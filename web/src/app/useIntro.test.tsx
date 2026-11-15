import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTRO_STORAGE_KEY, INTRO_TIMING } from "./introMode";
import { useIntro } from "./useIntro";

/** The setup file presents tests as automation (no intro); these tests are a person's first visit. */
function asPerson(): void {
  Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
}

describe("useIntro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    asPerson();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => true });
  });

  it("holds the map under the title, plays once the map is ready and the title has been read, then hands over", () => {
    const { result } = renderHook(() => useIntro("hr", false));
    expect(result.current).toMatchObject({ mode: "full", phase: "title", map: "hold", theme: "dark" });
    act(() => {
      result.current.onMapReady();
    });
    expect(result.current.phase).toBe("title"); // the title gets its time first
    act(() => {
      vi.advanceTimersByTime(INTRO_TIMING.titleMs);
    });
    expect(result.current).toMatchObject({ phase: "play", map: "play", theme: "dark" });
    act(() => {
      result.current.onMapDone();
    });
    // the map settles while the overlay fades; the reader's own theme comes back (a light theme dawns)
    expect(result.current).toMatchObject({ phase: "handoff", map: "play", theme: null });
    expect(window.localStorage.getItem(INTRO_STORAGE_KEY)).toBe("1");
    act(() => {
      vi.advanceTimersByTime(INTRO_TIMING.handoffMs);
    });
    expect(result.current).toMatchObject({ phase: "done", map: null, theme: null });
  });

  it("goes straight to the ordinary map when skipped", () => {
    const { result } = renderHook(() => useIntro("hr", false));
    act(() => {
      result.current.skip();
    });
    expect(result.current).toMatchObject({ phase: "handoff", map: null });
  });

  it("gives up on a map that does not arrive, and gets out of the way of a data error", () => {
    const { result } = renderHook(() => useIntro("hr", false));
    act(() => {
      vi.advanceTimersByTime(INTRO_TIMING.giveUpMs);
    });
    expect(result.current).toMatchObject({ phase: "handoff", map: null });
    const failed = renderHook(() => useIntro("hr", true));
    expect(failed.result.current.phase).toBe("done");
  });

  it("is not there for a returning visitor", () => {
    window.localStorage.setItem(INTRO_STORAGE_KEY, "1");
    const { result } = renderHook(() => useIntro("hr", false));
    expect(result.current).toMatchObject({ mode: "none", phase: "done", map: null, theme: null });
  });
});
