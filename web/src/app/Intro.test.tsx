import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "../test/render";
import { Intro } from "./Intro";

describe("Intro", () => {
  it("shows the title and skips on its button, a click anywhere, a key or the wheel", () => {
    const onSkip = vi.fn();
    const { container } = renderWithI18n(<Intro mode="full" phase="title" onSkip={onSkip} />);
    expect(screen.getByText("Energetska karta Hrvatske i regije")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preskoči uvod" }));
    expect(onSkip).toHaveBeenCalled();
    onSkip.mockClear();
    const overlay = container.querySelector("[data-intro-overlay]");
    if (!overlay) throw new Error("no overlay");
    fireEvent.click(overlay);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.wheel(window);
    expect(onSkip).toHaveBeenCalledTimes(3);
  });

  it("skips when a finger drags across it, which never becomes a click (Faza 56, 4.4f)", () => {
    const onSkip = vi.fn();
    renderWithI18n(<Intro mode="full" phase="play" onSkip={onSkip} />);
    fireEvent.touchMove(window);
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("lets Tab move focus without skipping", () => {
    const onSkip = vi.fn();
    renderWithI18n(<Intro mode="full" phase="play" onSkip={onSkip} />);
    fireEvent.keyDown(window, { key: "Tab" });
    fireEvent.keyDown(window, { key: "Shift" });
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("stops listening once it is handing over", () => {
    const onSkip = vi.fn();
    renderWithI18n(<Intro mode="still" phase="handoff" onSkip={onSkip} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.touchMove(window);
    expect(onSkip).not.toHaveBeenCalled();
  });
});
