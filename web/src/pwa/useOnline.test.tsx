import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_SOURCE_MESSAGE } from "./dataSource";
import { listenToWorker, useOnline } from "./useOnline";

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
  listenToWorker(worker);
});

afterEach(() => {
  setOnline(true);
  fromWorker("network");
});

describe("useOnline (Faza 59)", () => {
  it("counts a word from the worker that came before the map was there to listen (59-B)", () => {
    // offline, the data index is served from a kept copy while the page is still loading
    fromWorker("cache");
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);
  });

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

  it("lets the notice go when the browser says the network is back, before the worker says anything", () => {
    const { result } = renderHook(() => useOnline());
    act(() => {
      fromWorker("cache");
      setOnline(false);
    });
    expect(result.current).toBe(false);
    act(() => {
      setOnline(true);
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
