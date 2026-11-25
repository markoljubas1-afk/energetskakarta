import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMissingSelection, type Place } from "./useMissingSelection";

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(selected: string | null, place: Place | null | Error) {
  const locate = vi.fn((): Promise<Place | null> =>
    place instanceof Error ? Promise.reject(place) : Promise.resolve(place),
  );
  const flyTo = vi.fn();
  const hook = renderHook(({ id }) => useMissingSelection(id, locate, flyTo), {
    initialProps: { id: selected },
  });
  return { ...hook, locate, flyTo };
}

describe("a linked object the loaded map does not have (Faza 56, 4.4a)", () => {
  it("flies to it once when the search index knows where it is", async () => {
    const { result, locate, flyTo } = setup("osm:node/2", { lon: 15.95, lat: 45.55 });
    act(() => {
      result.current.onMissing("osm:node/2");
    });
    await waitFor(() => {
      expect(flyTo).toHaveBeenCalledWith(15.95, 45.55);
    });
    expect(result.current.notFound).toBe(false);
    // the map settles while the index is still loading or the flight runs: no second look-up
    act(() => {
      result.current.onMissing("osm:node/2");
    });
    expect(locate).toHaveBeenCalledOnce();
  });

  it("says it is not found when it is still missing after the flight", async () => {
    const { result, flyTo } = setup("osm:node/2", { lon: 15.95, lat: 45.55 });
    act(() => {
      result.current.onMissing("osm:node/2");
    });
    await waitFor(() => {
      expect(flyTo).toHaveBeenCalledOnce();
    });
    act(() => {
      result.current.onMissing("osm:node/2");
    });
    expect(result.current.notFound).toBe(true);
    expect(flyTo).toHaveBeenCalledOnce();
  });

  it("says it is not found when the index does not have it", async () => {
    const { result, flyTo } = setup("osm:way/9", null);
    act(() => {
      result.current.onMissing("osm:way/9");
    });
    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });
    expect(flyTo).not.toHaveBeenCalled();
  });

  it("says it is not found when the index cannot be loaded, and logs why", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = setup("osm:way/9", new Error("HTTP 503"));
    act(() => {
      result.current.onMissing("osm:way/9");
    });
    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });
    expect(log).toHaveBeenCalled();
  });

  it("ignores a report for something no longer selected, and starts over for a new selection", async () => {
    const { result, rerender, locate } = setup("osm:way/9", null);
    act(() => {
      result.current.onMissing("osm:node/old");
    });
    expect(locate).not.toHaveBeenCalled();
    act(() => {
      result.current.onMissing("osm:way/9");
    });
    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });
    rerender({ id: "osm:way/10" });
    expect(result.current.notFound).toBe(false);
  });
});
