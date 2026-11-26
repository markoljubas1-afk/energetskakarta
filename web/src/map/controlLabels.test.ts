import { describe, expect, it } from "vitest";

import { labelControls } from "./controlLabels";

describe("MapLibre's buttons in the page's language (Faza 57)", () => {
  it("names the zoom buttons and the credits button, for a mouse and for a screen reader", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button class="maplibregl-ctrl-zoom-in" title="Zoom in" aria-label="Zoom in"></button>
      <button class="maplibregl-ctrl-zoom-out" title="Zoom out" aria-label="Zoom out"></button>
      <button class="maplibregl-ctrl-attrib-button" title="Toggle attribution" aria-label="Toggle attribution"></button>`;
    labelControls(container, { zoomIn: "Približi", zoomOut: "Udalji", credits: "Prikaži ili sakrij izvore" });
    const named = [...container.querySelectorAll("button")].map((b) => [
      b.title,
      b.getAttribute("aria-label"),
    ]);
    expect(named).toEqual([
      ["Približi", "Približi"],
      ["Udalji", "Udalji"],
      ["Prikaži ili sakrij izvore", "Prikaži ili sakrij izvore"],
    ]);
  });

  it("leaves a map without those buttons alone", () => {
    const container = document.createElement("div");
    expect(() => {
      labelControls(container, { zoomIn: "a", zoomOut: "b", credits: "c" });
    }).not.toThrow();
  });
});
