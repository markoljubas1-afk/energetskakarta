import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithI18n } from "../test/render";
import { OfflineNotice } from "./OfflineNotice";

describe("the notice without a network (Faza 59)", () => {
  it("says the data on screen is the last saved, and that unopened parts of the map stay empty", () => {
    renderWithI18n(<OfflineNotice />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nema veze s mrežom: prikazani su zadnji spremljeni podaci.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Dijelovi karte koji nisu bili otvoreni ostaju prazni.",
    );
  });
});
