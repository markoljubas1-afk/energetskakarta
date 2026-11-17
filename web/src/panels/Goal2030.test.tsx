import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SAMPLE_RENEWABLES } from "../data/eurostat.fixture";
import { progress, target2030, TARGETS_2030, type Target2030 } from "../data/targets";
import { renderWithI18n } from "../test/render";
import { Goal2030 } from "./Goal2030";

/** An invented plan: the fixture's Croatia stands at 34.1 % in 2024, Bosnia and Herzegovina at 49 % in 2023. */
const TARGETS: Partial<Record<string, Target2030[]>> = {
  HR: [{ indicator: "REN", value: 42.5, source: "Plan Primjer", sourceUrl: "https://plan.test/hr.pdf" }],
  BA: [{ indicator: "REN", value: 43.6, source: "Plan Primjer BA", sourceUrl: "https://plan.test/ba.pdf" }],
};

describe("the 2030 target", () => {
  it("measures the latest official share against the target, from the figures as shown", () => {
    const [target] = TARGETS.HR ?? [];
    if (!target) throw new Error("fixture");
    const state = progress(target, { year: 2024, value: 34.123 });
    expect(state.gap).toBe(8.4);
    expect(state.part).toBeCloseTo(34.1 / 42.5, 6);
    // past the target there is no negative gap and the ring is simply full
    expect(progress(target, { year: 2024, value: 50 })).toMatchObject({ gap: 0, part: 1 });
    expect(target2030("HR", "REN_ELC", TARGETS)).toBeNull();
    expect(target2030("XX", "REN", TARGETS)).toBeNull();
  });

  it("names every published target's source with an https link", () => {
    for (const targets of Object.values(TARGETS_2030)) {
      for (const target of targets) {
        expect(target.source).not.toBe("");
        expect(target.sourceUrl).toMatch(/^https:\/\//);
        expect(target.value).toBeGreaterThan(0);
        expect(target.value).toBeLessThanOrEqual(100);
      }
    }
  });

  it("shows the share, the target, the gap and both sources, and what the figure is not", () => {
    renderWithI18n(
      <Goal2030
        country="HR"
        renewables={SAMPLE_RENEWABLES}
        targets={TARGETS}
        moreHref="/zelena-tranzicija/"
      />,
    );
    const card = screen.getByRole("region", { name: "Cilj 2030." });
    expect(card).toHaveTextContent("Službeni udio 2024.: 34,1 %");
    expect(card).toHaveTextContent("Cilj za 2030.: 42,5 %");
    expect(card).toHaveTextContent("Do cilja još 8,4 post. bodova");
    expect(card).toHaveTextContent("80 %"); // 34.1 of 42.5
    expect(card).toHaveTextContent(/Nije ista mjera kao brojka iznad/);
    expect(screen.getByRole("link", { name: "Eurostat" })).toHaveAttribute(
      "href",
      SAMPLE_RENEWABLES.sourceUrl,
    );
    expect(screen.getByRole("link", { name: "Plan Primjer" })).toHaveAttribute(
      "href",
      "https://plan.test/hr.pdf",
    );
    expect(screen.getByRole("link", { name: "Više o tranziciji" })).toHaveAttribute(
      "href",
      "/zelena-tranzicija/",
    );
  });

  it("uses the last year a country reported, and says when the target is reached", () => {
    renderWithI18n(<Goal2030 country="BA" renewables={SAMPLE_RENEWABLES} targets={TARGETS} />);
    const card = screen.getByRole("region", { name: "Cilj 2030." });
    expect(card).toHaveTextContent("Službeni udio 2023.: 49 %");
    expect(card).toHaveTextContent("Cilj je dostignut.");
    expect(screen.queryByRole("link", { name: "Više o tranziciji" })).not.toBeInTheDocument();
  });

  it("shows nothing for a country without a verified target or without a share", () => {
    const { container } = renderWithI18n(
      <Goal2030 country="SI" renewables={SAMPLE_RENEWABLES} targets={TARGETS} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
