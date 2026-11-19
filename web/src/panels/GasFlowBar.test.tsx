import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { balance, flowCountries, GasFlowsSchema, type GasFlows } from "../data/gasFlows";
import { createI18n } from "../i18n";
import { gasFlowCardText } from "../share/gasFlowCard";
import { renderWithI18n } from "../test/render";
import { GasFlowBar } from "./GasFlowBar";

type Point = GasFlows["countries"][string]["points"][number];

/** A point with its flow in GWh on each of three gas days; null: not reported. */
const point = (
  key: string,
  label: string,
  direction: "entry" | "exit",
  gwh: (number | null)[],
  neighbour: string | null = null,
): Point => ({
  key,
  label,
  kind: GasFlowsSchema.shape.countries.valueType.shape.points.element.shape.kind.parse(
    ["LNG", "PRD", "UGS", "ITP", "FNC"].find((kind) => key.startsWith(kind)) ?? "OTHER",
  ),
  direction,
  neighbour,
  kwhPerDay: gwh.map((value) => (value === null ? null : value * 1e6)),
  status: gwh.map((value) => (value === null ? null : "P")),
});

/** Croatia's system as ENTSOG had it on 17 November 2026 (figures of the live answer, rounded). */
const FLOWS: GasFlows = {
  version: 1,
  generatedAt: "2026-11-19T10:00:00+00:00",
  source: "ENTSOG Transparency Platform",
  sourceUrl: "https://transparency.entsog.eu/",
  unit: "kWh/d",
  days: ["2026-11-16", "2026-11-17", "2026-11-18"],
  countries: {
    HR: {
      operatorKey: "HR-TSO-0001",
      operator: "Plinacro Ltd",
      points: [
        point("LNG-00032", "Croatia LNG", "entry", [98.7, 98.4, null]),
        point("PRD-00197", "Production (HR)", "entry", [19.4, 19.5, null]),
        point("UGS-00028", "UGS Croatia", "entry", [17.5, 3.3, null]),
        point("UGS-00028", "UGS Croatia", "exit", [0, 0, null]),
        point("ITP-00042", "Rogatec", "entry", [0, 0, null], "SI"),
        point("ITP-00042", "Rogatec", "exit", [24.9, 25.3, null], "SI"),
        point("ITP-00011", "Dravaszerdahely", "exit", [24.3, 26.3, null], "HU"),
        point("FNC-00018", "Final Consumers and Distribution (HR)", "exit", [83.1, 71.9, null]),
      ],
    },
  },
  missing: [],
};

/** The same document with every point of Croatia's system passed through `change`. */
function changed(change: (each: Point) => Point): GasFlows {
  const system = FLOWS.countries.HR;
  if (!system) throw new Error("the fixture has no Croatia");
  return { ...FLOWS, countries: { HR: { ...system, points: system.points.map(change) } } };
}

const ready = (flows: GasFlows) => ({ status: "ready", value: { kind: "ready", flows } }) as const;

describe("a country's gas balance", () => {
  it("is of the last day every point reported, with both sides added up", () => {
    const day = balance(FLOWS, "HR");
    // the 18th is not reported yet
    expect(day?.day).toBe("2026-11-17");
    expect(day?.operator).toBe("Plinacro Ltd");
    expect(day?.provisional).toBe(true);
    expect((day?.enteredKwh ?? 0) / 1e6).toBeCloseTo(121.2, 6);
    expect((day?.leftKwh ?? 0) / 1e6).toBeCloseTo(123.5, 6);
    expect((day?.consumersKwh ?? 0) / 1e6).toBeCloseTo(71.9, 6);
    // largest first; the border point nothing came through is kept, with a zero
    expect(day?.entries.map((row) => row.key)).toEqual(["LNG-00032", "PRD-00197", "UGS-00028", "ITP-00042"]);
    expect(day?.entries[0]?.share).toBeCloseTo(98.4 / 121.2, 6);
    expect(day?.entries[3]).toMatchObject({ kwh: 0, share: 0, neighbour: "SI" });
    expect(day?.exits.map((row) => row.key)).toEqual(["FNC-00018", "ITP-00011", "ITP-00042", "UGS-00028"]);
  });

  it("skips a day one point did not report, and is nothing without a complete day", () => {
    const gap: GasFlows = changed((each) =>
      each.key === "PRD-00197" ? { ...each, kwhPerDay: [19.4e6, null, null] } : each,
    );
    expect(balance(gap, "HR")?.day).toBe("2026-11-16");
    const none: GasFlows = changed((each) => ({ ...each, kwhPerDay: [null, null, null] }));
    expect(balance(none, "HR")).toBeNull();
    expect(balance(FLOWS, "SI")).toBeNull();
    expect(flowCountries(FLOWS, ["SI", "HR", "HU"])).toEqual(["HR"]);
  });
});

describe("the picture of where the gas came in", () => {
  it("shows the three largest entries as parts of what entered, and what went to customers", () => {
    const day = balance(FLOWS, "HR");
    if (!day) throw new Error("no balance");
    const text = gasFlowCardText(day, createI18n("hr"));
    expect(text.title).toBe("GridAtlas: Odakle je plin ušao");
    expect(text.subtitle).toBe("Hrvatska · plinski dan 17. studenoga 2026. · privremeni podaci");
    expect(text.figures).toEqual([
      {
        value: "81",
        unit: "%",
        label: "LNG terminal",
        note: "98,4 GWh od 121,2 GWh ušlih u transportni sustav",
      },
      { value: "16", unit: "%", label: "domaća polja", note: "19,5 GWh" },
      { value: "3", unit: "%", label: "iz skladišta", note: "3,3 GWh" },
    ]);
    expect(text.footer).toBe(
      "Kupcima u zemlji isporučeno 71,9 GWh · Izvor: ENTSOG Transparency Platform · gridatlas.eu",
    );
    const english = gasFlowCardText(day, createI18n("en"));
    expect(english.figures.map((figure) => figure.label)).toEqual([
      "LNG terminal",
      "the country's own fields",
      "from storage",
    ]);
    expect(english.footer).toContain("ENTSOG Transparency Platform");
  });

  it("names a border point with the country across the border, and leaves out what did not flow", () => {
    const imported: GasFlows = changed((each) =>
      each.key === "ITP-00042" && each.direction === "entry"
        ? { ...each, kwhPerDay: [0, 30e6, null], status: [null, "C", null] }
        : each.key === "UGS-00028" && each.direction === "entry"
          ? { ...each, kwhPerDay: [0, 0, null] }
          : each,
    );
    const day = balance(imported, "HR");
    if (!day) throw new Error("no balance");
    const labels = gasFlowCardText(day, createI18n("hr")).figures.map((figure) => figure.label);
    expect(labels).toEqual(["LNG terminal", "Rogatec (Slovenija)", "domaća polja"]);
  });
});

describe("the gas flow bar", () => {
  it("lists what entered and what left, each with its part, and says what the figures are not", () => {
    renderWithI18n(<GasFlowBar data={ready(FLOWS)} onClose={vi.fn()} />);
    const bar = screen.getByRole("region", {
      name: "Plin, Hrvatska: što je ušlo u sustav i kamo je otišlo",
    });
    expect(bar).toHaveTextContent(
      "Plinski dan 17. studenoga 2026., privremeni podaci operatora (Plinacro Ltd).",
    );
    const entered = within(bar).getByRole("list", { name: "Ušlo u transportni sustav: 121,2 GWh" });
    expect(
      within(entered)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "LNG terminal98,4 GWh · 81 %",
      "domaća polja19,5 GWh · 16 %",
      "iz skladišta3,3 GWh · 3 %",
      "Rogatec (Slovenija)0 GWh · 0 %",
    ]);
    const left = within(bar).getByRole("list", { name: "Izašlo iz transportnog sustava: 123,5 GWh" });
    expect(
      within(left)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "kupci i distribucija u zemlji71,9 GWh · 58 %",
      "Dravaszerdahely (Mađarska)26,3 GWh · 21 %",
      "Rogatec (Slovenija)25,3 GWh · 20 %",
      "u skladište0 GWh · 0 %",
    ]);
    expect(bar).toHaveTextContent("Ulaz nije potrošnja");
    expect(within(bar).getByRole("link", { name: "ENTSOG Transparency Platform" })).toHaveAttribute(
      "href",
      "https://transparency.entsog.eu/",
    );
  });

  it("shows nothing while there is nothing to show", () => {
    const { container } = renderWithI18n(<GasFlowBar data={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    renderWithI18n(<GasFlowBar data={{ status: "ready", value: { kind: "none" } }} onClose={vi.fn()} />);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
