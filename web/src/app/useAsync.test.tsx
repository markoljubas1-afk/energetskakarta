import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAsync } from "./useAsync";

describe("useAsync", () => {
  it("stays idle without a key", () => {
    const load = vi.fn();
    const { result } = renderHook(() => useAsync(null, load));
    expect(result.current[0]).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("goes from loading to ready", async () => {
    const { result } = renderHook(() => useAsync("a", () => Promise.resolve(42)));
    expect(result.current[0]).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current[0]).toEqual({ status: "ready", value: 42 });
    });
  });

  it("reports errors and loads again on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useAsync("a", load));
    await waitFor(() => {
      expect(result.current[0]).toMatchObject({ status: "error", error: { message: "boom" } });
    });
    act(() => {
      result.current[1]();
    });
    expect(result.current[0]).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current[0]).toEqual({ status: "ready", value: "ok" });
    });
  });

  it("aborts the old request when the key changes, so it can never win", async () => {
    let resolveFirst: (value: string) => void = () => undefined;
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise<string>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve("second");
    });
    const { result, rerender } = renderHook(({ key }) => useAsync(key, load), {
      initialProps: { key: "one" },
    });
    rerender({ key: "two" });
    await waitFor(() => {
      expect(result.current[0]).toEqual({ status: "ready", value: "second" });
    });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      resolveFirst("first");
      await Promise.resolve();
    });
    expect(result.current[0]).toEqual({ status: "ready", value: "second" });
  });

  it("reloads in the background without showing loading, and keeps the last good copy on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    const load = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(3);
    const seen: unknown[] = [];
    const { result } = renderHook(() => {
      const state = useAsync("live", load, { refreshMs: 15 });
      seen.push(state[0]);
      return state;
    });
    await waitFor(() => {
      expect(result.current[0]).toEqual({ status: "ready", value: 2 });
    });
    // the failed third load leaves 2 on screen until the fourth brings 3
    await waitFor(() => {
      expect(result.current[0]).toEqual({ status: "ready", value: 3 });
    });
    const afterFirst = seen.slice(
      seen.findIndex((s) => JSON.stringify(s) === '{"status":"ready","value":1}'),
    );
    expect(afterFirst.some((s) => JSON.stringify(s) === '{"status":"loading"}')).toBe(false);
    expect(afterFirst.some((s) => (s as { status: string }).status === "error")).toBe(false);
  });

  it("does not reload in the background without refreshMs", async () => {
    const load = vi.fn().mockResolvedValue("once");
    const { result } = renderHook(() => useAsync("a", load));
    await waitFor(() => {
      expect(result.current[0]).toEqual({ status: "ready", value: "once" });
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
