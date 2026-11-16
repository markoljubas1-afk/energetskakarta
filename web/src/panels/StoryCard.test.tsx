import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { STORIES } from "../stories/stories";
import { renderWithI18n } from "../test/render";
import { StoryCard } from "./StoryCard";

const story = STORIES["put-struje"];

describe("StoryCard", () => {
  it("shows a step and asks for the next one; the first step has nowhere to go back to", async () => {
    const onStep = vi.fn();
    renderWithI18n(<StoryCard story={story} step={0} onStep={onStep} onLeave={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Jedna mreža za cijelu regiju" })).toBeInTheDocument();
    expect(screen.getByText(story.title.hr)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: `Korak 1 od ${story.steps.length}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Natrag" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Dalje" }));
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it("ends on the last step, and can be closed at any time", async () => {
    const onLeave = vi.fn();
    const onStep = vi.fn();
    const last = story.steps.length - 1;
    renderWithI18n(<StoryCard story={story} step={last} onStep={onStep} onLeave={onLeave} />);
    expect(screen.queryByRole("button", { name: "Dalje" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Natrag" }));
    expect(onStep).toHaveBeenCalledWith(last - 1);
    await userEvent.click(screen.getByRole("button", { name: "Završi" }));
    await userEvent.click(screen.getByRole("button", { name: "Zatvori priču" }));
    expect(onLeave).toHaveBeenCalledTimes(2);
  });
});
