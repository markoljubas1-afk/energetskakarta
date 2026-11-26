import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_SOURCE_MESSAGE } from "./dataSource";
import { useOnline } from "./useOnline";

const setOnline = (online: boolean): void => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

/** navigator.serviceWorker as the page sees it: messages from the worker, delivered once started. */
let worker: EventTarget & { startMessages: () => void };
const fromWorker = (source: "network" | "cache"): void => {
  worker.dispatchEvent(new MessageEvent("message", { data: { type: DATA_SOURCE_MESSAGE, source } }));
};

beforeEach(() => {
  worker = Object.assign(new EventTarget(), { startMessages: () => undefined });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, get: () => worker });
});

afterEach(() => {
  setOnline(true);
  fromWorker("network");
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

  it("believes the service worker over the browser: data served from its copies means no network", () => {
    // a network the browser calls connected, that reaches nothing (a Wi-Fi without internet, an emulated outage)
    const { result } = renderHook(() => useOnline());
    act(() => {
      fromWorker("cache");
    });
    expect(result.current).toBe(false);
    act(() => {
      fromWorker("network");
    });
    expect(result.current).toBe(true);
  });

  it("ignores messages that are not the worker's word on where data came from", () => {
    const { result } = renderHook(() => useOnline());
    act(() => {
      worker.dispatchEvent(
        new MessageEvent("message", { data: { type: "something-else", source: "cache" } }),
      );
    });
    expect(result.current).toBe(true);
  });
});
