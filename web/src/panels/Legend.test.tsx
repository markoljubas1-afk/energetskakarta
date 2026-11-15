import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { renderWithI18n } from "../test/render";
import { Legend } from "./Legend";

const legend = (): HTMLDetailsElement => {
  const element = screen.getByText("Legenda").closest("details");
  if (!element) throw new Error("legend <details> not found");
  return element;
};

describe("Legend", () => {
  it("is open by default and lists every voltage class and technology", () => {
    renderWithI18n(
      <Legend
        theme="light"
        compact={false}
        distribution={false}
        chargers={false}
        extraction={false}
        gas={false}
        cities={false}
      />,
    );
    expect(legend().open).toBe(true);
    expect(screen.getByText("380 kV i više")).toBeInTheDocument();
    expect(screen.getByText("Reverzibilna hidro")).toBeInTheDocument();
  });

  it("collapses while compact and reopens when compact ends", () => {
    const { rerender } = renderWithI18n(
      <Legend
        theme="light"
        compact
        distribution={false}
        chargers={false}
        extraction={false}
        gas={false}
        cities={false}
      />,
    );
    expect(legend().open).toBe(false);
    rerender(
      <I18nProvider lang="hr">
        <Legend
          theme="light"
          compact={false}
          distribution={false}
          chargers={false}
          extraction={false}
          gas={false}
          cities={false}
        />
      </I18nProvider>,
    );
    expect(legend().open).toBe(true);
  });

  it("keeps the user's explicit choice even when compact changes", () => {
    const { rerender } = renderWithI18n(
      <Legend
        theme="dark"
        compact
        distribution={false}
        chargers={false}
        extraction={false}
        gas={false}
        cities={false}
      />,
    );
    legend().open = true;
    fireEvent(legend(), new Event("toggle"));
    rerender(
      <I18nProvider lang="hr">
        <Legend
          theme="dark"
          compact
          distribution={false}
          chargers={false}
          extraction={false}
          gas={false}
          cities={false}
        />
      </I18nProvider>,
    );
    expect(legend().open).toBe(true);
  });

  it("names the sub-60 kV class only while the distribution layer is on", () => {
    const { rerender } = renderWithI18n(
      <Legend
        theme="light"
        compact={false}
        distribution={false}
        chargers={false}
        extraction={false}
        gas={false}
        cities={false}
      />,
    );
    expect(screen.queryByText("Ispod 60 kV")).toBeNull();
    rerender(
      <I18nProvider lang="hr">
        <Legend
          theme="light"
          compact={false}
          distribution
          chargers={false}
          extraction={false}
          gas={false}
          cities={false}
        />
      </I18nProvider>,
    );
    expect(screen.getByText("Ispod 60 kV")).toBeInTheDocument();
  });
});
