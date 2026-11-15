import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AsyncState } from "../app/useAsync";
import type { HepLoad } from "../data/hep";
import { RELEASE } from "../data/hep.fixture";
import { renderWithI18n } from "../test/render";
import { CapacityBar } from "./CapacityBar";

const ready: AsyncState<HepLoad> = {
  status: "ready",
  value: { kind: "ready", release: RELEASE, history: null },
};

describe("CapacityBar", () => {
  it("counts the substations in each band, names the source and carries HEP ODS's note", () => {
    renderWithI18n(
      <CapacityBar data={ready} theme="light" selected={null} onSelect={vi.fn()} onRetry={vi.fn()} />,
    );
    const legend = screen.getByRole("list", { name: "Kategorije prihvata" });
    expect(legend.querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByText(/^Izvor: HEP ODS \(kapaciteti\.hep\.hr\), stanje /)).toBeInTheDocument();
    expect(screen.getByText(/ne jamče priključenje/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Slobodni kapaciteti mreže (HEP ODS)" })).toHaveAttribute(
      "href",
      "/kapaciteti/",
    );
    expect(screen.getByText(/Klikni trafostanicu na karti/)).toBeInTheDocument();
  });

  it("shows a clicked substation: category now and with an upgrade, and a link to its page", async () => {
    const onSelect = vi.fn();
    renderWithI18n(
      <CapacityBar
        data={ready}
        theme="dark"
        selected="TS 110/35kV POKUPJE"
        onSelect={onSelect}
        onRetry={vi.fn()}
      />,
    );
    // once in the legend, once on the card
    expect(screen.getAllByText("C: do 20 MW")).toHaveLength(2);
    expect(screen.getAllByText("D: više od 20 MW")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Povijest i pojedinosti trafostanice" })).toHaveAttribute(
      "href",
      "/kapaciteti/ts-110-35kv-pokupje/",
    );
    await userEvent.click(screen.getByRole("button", { name: "Zatvori trafostanicu" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("says so before the first release, and offers a retry when loading failed", async () => {
    const none: AsyncState<HepLoad> = { status: "ready", value: { kind: "none" } };
    const { unmount } = renderWithI18n(
      <CapacityBar data={none} theme="light" selected={null} onSelect={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("još nisu objavljeni");
    unmount();
    const onRetry = vi.fn();
    renderWithI18n(
      <CapacityBar
        data={{ status: "error", error: new Error("x") }}
        theme="light"
        selected={null}
        onSelect={vi.fn()}
        onRetry={onRetry}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
