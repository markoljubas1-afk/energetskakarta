import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useOnline } from "./useOnline";

const setOnline = (online: boolean): void => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

afterEach(() => {
  setOnline(true);
});

describe("useOnline (Faza 59)", () => {
  it("follows the browser's network state as it changes", () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    act(() => {
      setOnline(false);
    });
    expect(result.current).toBe(false);
    act(() => {
      setOnline(true);
    });
    expect(result.current).toBe(true);
  });
});
