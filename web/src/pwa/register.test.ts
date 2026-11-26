import { describe, expect, it, vi } from "vitest";

import { registerServiceWorker } from "./register";

function fakes(supported = true, register = vi.fn(() => Promise.resolve())) {
  const listeners: (() => void)[] = [];
  return {
    register,
    navigator: supported ? { serviceWorker: { register } } : {},
    window: { addEventListener: (_: "load", listener: () => void) => listeners.push(listener) },
    load: () => {
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

describe("registering the service worker (Faza 59)", () => {
  it("registers /sw.js once the page has loaded, in a production build", () => {
    const f = fakes();
    registerServiceWorker(true, f.navigator, f.window);
    expect(f.register).not.toHaveBeenCalled(); // the page's own loading comes first
    f.load();
    expect(f.register).toHaveBeenCalledWith("/sw.js");
  });

  it("does nothing in development, nor in a browser without service workers", () => {
    const dev = fakes();
    registerServiceWorker(false, dev.navigator, dev.window);
    dev.load();
    expect(dev.register).not.toHaveBeenCalled();
    const old = fakes(false);
    registerServiceWorker(true, old.navigator, old.window);
    old.load();
    expect(old.register).not.toHaveBeenCalled();
  });

  it("says so when the worker cannot be registered: the site still works, only not offline", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = fakes(
      true,
      vi.fn(() => Promise.reject(new Error("SecurityError"))),
    );
    registerServiceWorker(true, f.navigator, f.window);
    f.load();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
  });
});
