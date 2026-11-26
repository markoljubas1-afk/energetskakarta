import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useUrlState } from "./url";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the address and the browser history (Faza 56, 4.4c)", () => {
  it("picking an object adds a history step; panning only replaces the current one", () => {
    window.history.replaceState(null, "", "/?v=45.0000,16.0000,7.00");
    const before = window.history.length;
    const { result } = renderHook(() => useUrlState());
    act(() => {
      result.current[1]((s) => ({ ...s, selected: "osm:node/1" }));
    });
    expect(window.history.length).toBe(before + 1);
    act(() => {
      result.current[1]((s) => ({ ...s, view: { lat: 45.5, lng: 16.5, zoom: 8 } }));
    });
    expect(window.history.length).toBe(before + 1);
    expect(result.current[0].view).toEqual({ lat: 45.5, lng: 16.5, zoom: 8 });
    expect(result.current[0].selected).toBe("osm:node/1");
  });

  it("follows the browser when it goes back to an earlier step", () => {
    window.history.replaceState(null, "", "/?sel=osm:node/1");
    const { result } = renderHook(() => useUrlState());
    act(() => {
      result.current[1]((s) => ({ ...s, selected: "osm:node/2" }));
    });
    expect(result.current[0].selected).toBe("osm:node/2");
    act(() => {
      // what Back does: the address is the earlier one, then the browser says so
      window.history.replaceState(null, "", "/?sel=osm:node/1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0].selected).toBe("osm:node/1");
  });
});
