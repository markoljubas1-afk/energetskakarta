/**
 * MapLibre names its own buttons in English ("Zoom in", "Toggle attribution"). Its `locale` option is read
 * only when the map is made, and the page changes language without making a new map, so the names are set
 * on the buttons themselves whenever the language or the credits (a new button) change (Faza 57).
 */
export interface ControlLabels {
  zoomIn: string;
  zoomOut: string;
  credits: string;
}

export function labelControls(container: HTMLElement, labels: ControlLabels): void {
  const named: [string, string][] = [
    [".maplibregl-ctrl-zoom-in", labels.zoomIn],
    [".maplibregl-ctrl-zoom-out", labels.zoomOut],
    [".maplibregl-ctrl-attrib-button", labels.credits],
  ];
  for (const [selector, label] of named) {
    container.querySelectorAll<HTMLElement>(selector).forEach((button) => {
      button.title = label;
      button.setAttribute("aria-label", label);
    });
  }
}
