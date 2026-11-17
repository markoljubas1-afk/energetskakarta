import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { renderWithI18n } from "../test/render";
import { DetailsPanel } from "./DetailsPanel";

describe("DetailsPanel", () => {
  it("marks a new part of a running plant in the title and explains it", () => {
    renderWithI18n(
      <DetailsPanel
        id="gem:L100000500165:planned"
        onClose={vi.fn()}
        selection={{
          id: "gem:L100000500165:planned",
          sources: ["gem"],
          gemUrl: null,
          kind: "plant",
          expansion: true,
          status: "planned",
          operator: null,
          name: "NE Primjer",
          technology: "nuclear",
          capacityMw: 1100,
          commissioningYear: 2035,
          country: "SI",
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "NE Primjer (planirano proširenje)" })).toBeInTheDocument();
    expect(screen.getByText(/Novi dio elektrane koja na istoj lokaciji već radi/)).toBeInTheDocument();
  });

  it("shows a plant with source link", () => {
    renderWithI18n(
      <DetailsPanel
        id="osm:way/109"
        onClose={vi.fn()}
        selection={{
          id: "osm:way/109",
          sources: ["openstreetmap"],
          gemUrl: null,
          kind: "plant",
          expansion: false,
          status: "operating",
          operator: null,
          name: "RHE Primjer",
          technology: "pumped_storage",
          capacityMw: 276,
          commissioningYear: 1985,
          country: "HR",
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "RHE Primjer" })).toBeInTheDocument();
    const rows = screen.getAllByRole("definition").map((cell) => cell.textContent);
    expect(rows).toEqual(["U pogonu", "Reverzibilna hidro", "276 MW", "1985", "Nepoznato", "Hrvatska"]);
    const link = screen.getByRole("link", { name: /Pogledaj ili ispravi/ });
    expect(link).toHaveAttribute("href", "https://www.openstreetmap.org/way/109");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("folds down to its title and back, and opens again for another object", () => {
    const plant = {
      id: "osm:way/109",
      sources: ["openstreetmap" as const],
      gemUrl: null,
      kind: "plant" as const,
      expansion: false,
      status: "operating" as const,
      operator: null,
      name: "RHE Primjer",
      technology: "pumped_storage" as const,
      capacityMw: 276,
      commissioningYear: 1985,
      country: "HR",
    };
    const view = renderWithI18n(<DetailsPanel id={plant.id} onClose={vi.fn()} selection={plant} />);
    const panel = screen.getByRole("heading", { name: "RHE Primjer" }).closest("[class*=panel]");
    fireEvent.click(screen.getByRole("button", { name: "Spusti karticu" }));
    expect(panel).toHaveAttribute("data-folded");
    expect(screen.getByRole("button", { name: "Podigni karticu" })).toHaveAttribute("aria-expanded", "false");
    // the title and the close button stay
    expect(screen.getByRole("heading", { name: "RHE Primjer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zatvori detalje" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Podigni karticu" }));
    expect(panel).not.toHaveAttribute("data-folded");

    fireEvent.click(screen.getByRole("button", { name: "Spusti karticu" }));
    view.rerender(
      <I18nProvider lang="hr">
        <DetailsPanel id="osm:way/110" onClose={vi.fn()} selection={{ ...plant, id: "osm:way/110" }} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Spusti karticu" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows an interconnector line in English", () => {
    renderWithI18n(
      <DetailsPanel
        id="osm:way/100"
        onClose={vi.fn()}
        selection={{
          id: "osm:way/100",
          sources: ["openstreetmap"],
          gemUrl: null,
          kind: "line",
          status: "construction",
          operator: "HOPS; ELES",
          voltagesKv: [400, 220],
          maxVoltageKv: 400,
          circuits: 2,
          isHvdc: false,
          isInterconnector: true,
          countries: ["HR", "SI"],
        }}
      />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Power line, 400 kV" })).toBeInTheDocument();
    expect(screen.getByText("Interconnector")).toBeInTheDocument();
    expect(screen.getByText("400 / 220 kV")).toBeInTheDocument();
    expect(screen.getByText("Croatia, Slovenia")).toBeInTheDocument();
    expect(screen.getByText("Under construction")).toBeInTheDocument();
  });

  it("explains a selection whose details are not loaded yet", () => {
    renderWithI18n(<DetailsPanel id="osm:node/1" selection={null} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Učitavanje detalja…" })).toBeInTheDocument();
    expect(screen.getByText(/Približite kartu/)).toBeInTheDocument();
  });

  it("closes with the button and with Escape, but not while typing", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(
      <>
        <input aria-label="field" />
        <DetailsPanel id="osm:node/1" selection={null} onClose={onClose} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Zatvori detalje" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("textbox", { name: "field" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("links GEM and not OpenStreetMap for a GEM-only plant", () => {
    renderWithI18n(
      <DetailsPanel
        id="gem:L100000000004:operating"
        onClose={vi.fn()}
        selection={{
          id: "gem:L100000000004:operating",
          sources: ["gem"],
          gemUrl: "https://www.gem.wiki/Vjetroelektrana_Daleko",
          kind: "plant",
          expansion: false,
          status: "operating",
          operator: "Vjetar d.d.",
          name: "Vjetroelektrana Daleko",
          technology: "wind",
          capacityMw: 1200,
          commissioningYear: 2019,
          country: "HR",
        }}
      />,
    );
    expect(screen.getByText(/Izvori: Global Energy Monitor/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /OpenStreetMap/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GEM wikiju/ })).toHaveAttribute(
      "href",
      "https://www.gem.wiki/Vjetroelektrana_Daleko",
    );
    expect(screen.getByText("1,2 GW")).toBeInTheDocument();
  });

  it("describes an offshore pipeline without an OpenStreetMap link", () => {
    renderWithI18n(
      <DetailsPanel
        id="emodnet:pipelines/101"
        onClose={vi.fn()}
        selection={{
          id: "emodnet:pipelines/101",
          sources: ["emodnet"],
          gemUrl: null,
          kind: "pipeline",
          status: "operating",
          operator: "INA",
          name: "Plinovod Primjer",
          medium: "gas",
          diameterIn: 12,
          lengthKm: 76,
          commissioningYear: 2006,
          countries: ["HR", "IT"],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Plinovod Primjer" })).toBeInTheDocument();
    const rows = screen.getAllByRole("definition").map((cell) => cell.textContent);
    expect(rows).toEqual(["U pogonu", "Plin", "305 mm (12 in)", "76 km", "2006", "INA", "Hrvatska, Italija"]);
    expect(screen.getByText(/Izvori: EMODnet/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
