import { describe, expect, it } from "vitest";

import { keyFigures, mixBar, rankBars, shareColumns, sourceBars, splitUnit, tableBehind } from "./charts";
import { blocks } from "./markdown";

describe("key figures", () => {
  it("colours a change by whether a rise is good news, and leaves a neutral one uncoloured", () => {
    const html = keyFigures(
      [
        {
          label: "Udio obnovljivih",
          value: "65,7",
          unit: "%",
          change: { value: 3.4, text: "3,4 p. b.", against: "prema istom mjesecu 2025.", rise: "good" },
        },
        {
          label: "CO₂",
          value: "198",
          unit: "g/kWh",
          change: { value: -0.23, text: "23,3 %", against: "x", rise: "bad" },
        },
        {
          label: "Proizvodnja",
          value: "879",
          unit: "GWh",
          change: { value: -0.147, text: "14,7 %", against: "x", rise: "neutral" },
        },
      ],
      "Ključne brojke",
    );
    expect(html).toContain('<section class="kpis" aria-label="Ključne brojke">');
    expect(html).toContain('<p class="big">65,7<small>%</small></p>');
    // more renewables: good; less CO₂: good; less generation: neither
    expect(html).toMatch(
      /delta good"><b aria-hidden="true">▲<\/b> 3,4 p\. b\.<\/span> prema istom mjesecu 2025\./,
    );
    expect(html).toMatch(/delta good"><b aria-hidden="true">▼<\/b> 23,3 %/);
    expect(html).toMatch(/delta neutral"><b aria-hidden="true">▼<\/b> 14,7 %/);
    expect(keyFigures([], "x")).toBe("");
  });

  it("splits a figure from its unit", () => {
    expect(splitUnit("879 GWh")).toEqual(["879", "GWh"]);
    expect(splitUnit("1,43 TWh")).toEqual(["1,43", "TWh"]);
    expect(splitUnit("12")).toEqual(["12", ""]);
  });
});

describe("charts", () => {
  const sources = sourceBars(
    [
      {
        tech: "wind",
        name: "Vjetar",
        amount: "313 GWh",
        share: "35,6 %",
        value: 313,
        before: 329,
        change: "▼ 4,9 %",
      },
      {
        tech: "battery",
        name: "Baterije",
        amount: "4,7 GWh",
        share: "0,5 %",
        value: 4.7,
        before: 0,
        change: "novo",
      },
    ],
    { now: "listopad 2026.", before: "listopad 2025." },
  );

  it("draws bars to scale, the largest value full width, and a sliver for a small one", () => {
    // 329 (a year earlier) is the largest: full width; 313 is 951 of 1000
    expect(sources).toContain('<rect class="was" x="0" y="16" width="1000"');
    expect(sources).toContain('<rect class="t-wind" x="0" y="0" width="951"');
    // 4.7 of 329 would be 14; a source that had none a year earlier has no thin bar
    expect(sources).toContain('class="t-battery" x="0" y="0" width="14"');
    expect(sources).toContain('<rect class="was" x="0" y="16" width="0"');
    expect(sources).toContain("listopad 2025.");
  });

  it("splits the mix by share and leaves a month without generation out", () => {
    const mix = mixBar([
      { tech: "wind", value: 3 },
      { tech: "gas", value: 1 },
    ]);
    expect(mix).toContain('class="t-wind" x="0.0" y="0" width="747.0"');
    expect(mix).toContain('class="t-gas" x="750.0"');
    expect(mixBar([{ tech: "wind", value: 0 }])).toBe("");
  });

  it("leaves a month without data as a gap, not a zero, and names the marked month", () => {
    const html = shareColumns(
      [
        { label: "ruj 25", value: 0.5 },
        { label: "", value: null },
        { label: "lis 26", value: 0.657, mark: "now" },
      ],
      "",
    );
    expect(html.match(/<rect class="col/g)).toHaveLength(2);
    expect(html).toContain('class="col now"');
    expect(html).toContain('<span class="now">lis 26</span>');
  });

  it("marks the page's own row of a ranking", () => {
    const html = rankBars([
      {
        name: '<a href="/zemlja/at/">Austrija</a>',
        value: 0.659,
        text: "65,9 %",
        detail: "173 g/kWh · Hidro",
      },
      {
        name: '<a href="/zemlja/hr/">Hrvatska</a>',
        value: 0.657,
        text: "65,7 %",
        detail: "198 g/kWh",
        own: true,
      },
    ]);
    expect(html).toContain('<div class="rrow own">');
    expect(html).toContain('class="fill" x="0" y="0" width="659"');
  });

  it("never uses a style attribute (the pages' CSP allows none) nor tags Markdown would read as a paragraph", () => {
    const all = [
      sources,
      mixBar([{ tech: "hydro", value: 1 }]),
      shareColumns([{ label: "a", value: 0.3 }], ""),
      rankBars([{ name: "x", value: 0.2, text: "20 %", detail: "" }]),
      keyFigures([{ label: "a", value: "1", unit: "%" }], "x"),
    ].join("");
    expect(all).not.toMatch(/\sstyle=/);
    expect(all).not.toMatch(/<(path|polyline|polygon|pattern)\b/);
    // a chart beside its table: the Markdown copy keeps the table and drops the drawing
    const md = blocks(
      sources + tableBehind("Tablica", "<table><tr><th>A</th></tr><tr><td>1</td></tr></table>"),
      null,
    );
    expect(md).toBe("| A |\n| --- |\n| 1 |");
  });
});
