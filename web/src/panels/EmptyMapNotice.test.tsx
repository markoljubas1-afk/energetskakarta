import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "../test/render";
import { EmptyMapNotice } from "./EmptyMapNotice";

describe("the notice that nothing switched on is in view (Faza 57-C2)", () => {
  it("says so on the map, and offers to reset filters the reader changed", () => {
    const onReset = vi.fn();
    renderWithI18n(<EmptyMapNotice onReset={onReset} />);
    expect(screen.getByRole("status")).toHaveTextContent("Na ovom dijelu karte nema ničega od uključenoga");
    fireEvent.click(screen.getByRole("button", { name: "Poništi filtre" }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("only says what to do with the map when the filters are as they were", () => {
    renderWithI18n(<EmptyMapNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Približite ili pomaknite kartu");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
