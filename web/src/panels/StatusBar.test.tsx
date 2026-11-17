import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Current } from "../data/current";
import { renderWithI18n } from "../test/render";
import { dataAgeDays, StatusBar, STALE_AFTER_DAYS } from "./StatusBar";

const current: Current = {
  buildId: "20260914T030000Z",
  createdAt: "2026-09-14T03:00:00+00:00",
  counts: { lines: 1, substations: 1, plants: 1 },
  attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0",
  tiles: {
    grid: { url: "builds/x/grid.pmtiles", minZoom: 3, maxZoom: 14, bounds: [13, 42, 20, 47] },
    boundaries: { url: "builds/x/boundaries.pmtiles", minZoom: 0, maxZoom: 8, bounds: [5, 35, 25, 50] },
  },
  manifest: "builds/x/manifest.json",
  search: "builds/x/search.json",
  stats: "builds/x/stats.json",
  downloads: {
    lines: "builds/x/lines.ndjson.gz",
    substations: "builds/x/s.ndjson.gz",
    plants: "builds/x/p.ndjson.gz",
  },
};
const base = new URL("https://data.test/");

describe("StatusBar", () => {
  it("counts whole days of age", () => {
    expect(dataAgeDays(current.createdAt, new Date("2026-09-16T02:59:00Z"))).toBe(1);
    expect(dataAgeDays("not a date", new Date())).toBe(0);
  });

  it("shows the data date without a warning while data is fresh", () => {
    renderWithI18n(
      <StatusBar current={current} dataBaseUrl={base} basemap="fallback" basemapExpected={false}
        map={null}
        now={new Date("2026-09-20T12:00:00Z")} />,
    ); // prettier-ignore
    expect(screen.getByText(/^Karta od 14\. rujna 2026\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns when data is older than two missed weekly updates", () => {
    const now = new Date(Date.parse(current.createdAt) + (STALE_AFTER_DAYS + 1) * 24 * 3600 * 1000);
    renderWithI18n(
      <StatusBar
        current={current}
        dataBaseUrl={base}
        basemap="fallback"
        basemapExpected={false}
        map={null}
        now={now}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(`Stari su ${STALE_AFTER_DAYS + 1} dana`);
  });

  it("links every layer download and shows the MapTiler logo only with MapTiler", () => {
    renderWithI18n(
      <StatusBar
        current={current}
        dataBaseUrl={base}
        basemap="maptiler"
        basemapExpected
        map={null}
        now={new Date()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preuzmi bazu" })); // the downloads are in a menu
    expect(screen.getByRole("link", { name: "Elektrane" })).toHaveAttribute(
      "href",
      "https://data.test/builds/x/p.ndjson.gz",
    );
    expect(screen.getByRole("img", { name: "MapTiler" })).toBeInTheDocument();
    // this build has no offshore pipelines, so there is nothing to download for them
    expect(screen.queryByRole("link", { name: "Cjevovodi (more)" })).not.toBeInTheDocument();
  });

  it("lists the pipelines download when the build has it", () => {
    const withPipelines = {
      ...current,
      downloads: { ...current.downloads, pipelines: "builds/x/pl.ndjson.gz" },
    };
    renderWithI18n(
      <StatusBar
        current={withPipelines}
        dataBaseUrl={base}
        basemap="fallback"
        basemapExpected={false}
        map={null}
        now={new Date()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preuzmi bazu" })); // the downloads are in a menu
    expect(screen.getByRole("link", { name: "Cjevovodi (more)" })).toHaveAttribute(
      "href",
      "https://data.test/builds/x/pl.ndjson.gz",
    );
  });

  it("explains a failed MapTiler basemap", () => {
    renderWithI18n(
      <StatusBar current={current} dataBaseUrl={base} basemap="fallback" basemapExpected map={null} now={new Date("2026-09-15T00:00:00Z")} />,
    ); // prettier-ignore
    expect(screen.getByRole("status")).toHaveTextContent("Detaljna podloga nije dostupna");
  });
});
