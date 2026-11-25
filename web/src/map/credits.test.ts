import type { IControl } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import { showCredits, type CreditControls } from "./credits";

/** Just enough of a map to watch controls come and go, in the order the corner shows them (top first). */
function fakeMap() {
  const corner: IControl[] = [];
  const named = new Map<IControl, string>();
  return {
    corner: () => corner.map((control) => named.get(control)),
    controls: {
      credits: (text: string) => {
        const control = { onAdd: () => document.createElement("div"), onRemove: () => undefined };
        named.set(control, `credits: ${text}`);
        return control;
      },
      scale: () => {
        const control = { onAdd: () => document.createElement("div"), onRemove: () => undefined };
        named.set(control, "scale");
        return control;
      },
    } satisfies CreditControls,
    map: {
      // bottom controls stack upwards: the newest goes on top, like MapLibre's insertBefore(firstChild)
      addControl(control: IControl) {
        corner.unshift(control);
        return this;
      },
      removeControl(control: IControl) {
        corner.splice(corner.indexOf(control), 1);
        return this;
      },
      hasControl: (control: IControl) => corner.includes(control),
      getContainer: () => document.createElement("div"),
    },
  };
}

describe("map credits (Faza 56, 4.2)", () => {
  it("shows the text under the scale", () => {
    const fake = fakeMap();
    showCredits(fake.map as never, "OpenStreetMap", fake.controls);
    expect(fake.corner()).toEqual(["scale", "credits: OpenStreetMap"]);
  });

  it("replaces the text when the sources change, keeping the scale on top", () => {
    const fake = fakeMap();
    const remove = showCredits(fake.map as never, "OpenStreetMap", fake.controls);
    remove();
    showCredits(fake.map as never, "OpenStreetMap | ENTSOG | GIE", fake.controls);
    expect(fake.corner()).toEqual(["scale", "credits: OpenStreetMap | ENTSOG | GIE"]);
  });

  it("leaves alone controls that are no longer on the map (a removed map takes its own away)", () => {
    const fake = fakeMap();
    const remove = showCredits(fake.map as never, "OpenStreetMap", fake.controls);
    remove();
    const removeControl = vi.spyOn(fake.map, "removeControl");
    remove();
    expect(removeControl).not.toHaveBeenCalled();
    expect(fake.corner()).toEqual([]);
  });
});
