import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "../test/render";
import { useWelcome, Welcome } from "./Welcome";

function Harness({ selected, embed = false }: { selected: string | null; embed?: boolean }) {
  const [shown, dismiss] = useWelcome(embed, selected);
  const entries = { live: vi.fn(), changes: null, cities: vi.fn() };
  return shown ? <Welcome entries={entries} onClose={dismiss} /> : <p>gone</p>;
}

afterEach(() => {
  window.localStorage.clear();
});

describe("welcome card", () => {
  it("shows once, is remembered when closed, and lists only the entries the build has", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithI18n(<Harness selected={null} />);
    expect(screen.getByRole("heading", { name: "Dobro došli na energetsku kartu" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Što je novo/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Zatvori dobrodošlicu" }));
    expect(screen.getByText("gone")).toBeVisible();
    unmount();
    renderWithI18n(<Harness selected={null} />);
    expect(screen.getByText("gone")).toBeVisible();
  });

  it("stays away after the map has been used, and never appears in an embed", () => {
    renderWithI18n(<Harness selected="osm:node/1" />);
    expect(screen.getByText("gone")).toBeVisible();
    renderWithI18n(<Harness selected={null} embed />);
    expect(screen.getAllByText("gone")).toHaveLength(2);
  });

  it("takes an entry and closes", async () => {
    const user = userEvent.setup();
    const live = vi.fn();
    const onClose = vi.fn();
    renderWithI18n(<Welcome entries={{ live, changes: vi.fn(), cities: vi.fn() }} onClose={onClose} />);
    expect(screen.getByRole("button", { name: /Što je novo/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Tokovi struje uživo/ }));
    expect(live).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("links the support page in one quiet line only when that page is on", () => {
    const entries = { live: vi.fn(), changes: null, cities: vi.fn() };
    const { unmount } = renderWithI18n(<Welcome entries={entries} onClose={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "Podržite ga" })).not.toBeInTheDocument();
    unmount();
    renderWithI18n(<Welcome entries={entries} onClose={vi.fn()} support />);
    expect(screen.getByRole("link", { name: "Podržite ga" })).toHaveAttribute("href", "/podrska/");
  });
});
