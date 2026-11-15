import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SAMPLE_TIMELINE } from "../data/timeline.fixture";
import { TECHNOLOGIES } from "../domain";
import { renderWithI18n } from "../test/render";
import { TimeBar } from "./TimeBar";

const data = { status: "ready", value: SAMPLE_TIMELINE } as const;
const scope = { countries: new Set<never>(), technologies: new Set(TECHNOLOGIES) };

describe("TimeBar", () => {
  it("shows the year, what ran then and what the timeline leaves out", () => {
    renderWithI18n(
      <TimeBar data={data} year={1964} scope={scope} theme="light" onYear={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByText("1964.")).toBeInTheDocument();
    expect(screen.getByText("U pogonu 1964.: 626 MW")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Zatvorene do tada \(sivi obrisi\): 1, ukupno 125 MW\. Posljednja: TE Plomin 1, 1964\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Bez godine puštanja u pogon, pa nisu na karti: 4.")).toBeInTheDocument();
  });

  it("moves by year, keeps inside the timeline and closes", () => {
    const onYear = vi.fn();
    renderWithI18n(
      <TimeBar data={data} year={2026} scope={scope} theme="dark" onYear={onYear} onRetry={vi.fn()} />,
    );
    // a year past the timeline shows its last year
    expect(screen.getByText("1964.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prethodna godina" }));
    expect(onYear).toHaveBeenLastCalledWith(1963);
    fireEvent.change(screen.getByRole("slider", { name: "Godina" }), { target: { value: "1961" } });
    expect(onYear).toHaveBeenLastCalledWith(1961);
    fireEvent.click(screen.getByRole("button", { name: "Zatvori vremeplov" }));
    expect(onYear).toHaveBeenLastCalledWith(null);
  });

  it("plays one year per step", () => {
    vi.useFakeTimers();
    try {
      const onYear = vi.fn();
      renderWithI18n(
        <TimeBar data={data} year={1960} scope={scope} theme="light" onYear={onYear} onRetry={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Pusti" }));
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onYear).toHaveBeenLastCalledWith(1961);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a retry when the timeline fails", () => {
    const onRetry = vi.fn();
    renderWithI18n(
      <TimeBar
        data={{ status: "error", error: new Error("x") }}
        year={1970}
        scope={scope}
        theme="light"
        onYear={vi.fn()}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("can be passed on: its capacity by year as CSV and a citation, but no picture (Faza 27)", () => {
    renderWithI18n(
      <TimeBar data={data} year={1964} scope={scope} theme="light" onYear={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByLabelText("Podijeli: Vremeplov elektrana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preuzmi podatke (CSV)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spremi sliku (PNG)" })).not.toBeInTheDocument();
  });
});
