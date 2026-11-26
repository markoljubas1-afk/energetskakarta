import { describe, expect, it } from "vitest";

import { linkedTable, numericColumns, table } from "./markup";

describe("static page tables (Faza 58-A)", () => {
  it("knows a column of numbers from a column of words", () => {
    const rows = [
      ["Plomin", "Ugljen", "217 MW", "−3,5 %", "—"],
      ["Zakučac", "Hidro", "576 MW", "+12 %", "2026."],
    ];
    expect(numericColumns(rows, 5)).toEqual([false, false, true, true, true]);
  });

  it("keeps a number column when one of its cells is a word (a figure the sources do not give)", () => {
    const rows = [
      ["Vjetar", "nije navedeno"],
      ["Hidro", "2,1 GW"],
      ["Sunce", "560 MW"],
    ];
    expect(numericColumns(rows, 2)).toEqual([false, true]);
  });

  it("never counts the first column, nor a column that is empty", () => {
    expect(numericColumns([["1", ""]], 2)).toEqual([false, false]);
  });

  it("aligns only the numbers, and names its headers' scope for screen readers", () => {
    const html = table(
      ["Elektrana", "Vrsta", "Snaga"],
      [
        ["Plomin", "Ugljen", "217 MW"],
        ["Zakučac", "Hidro", "576 MW"],
      ],
    );
    expect(html).toContain(
      '<thead><tr><th scope="col">Elektrana</th><th scope="col">Vrsta</th><th scope="col" class="num">Snaga</th></tr></thead>',
    );
    expect(html).toContain('<tr><th scope="row">Plomin</th><td>Ugljen</td><td class="num">217 MW</td></tr>');
  });

  it("does the same for a table whose first column is a link", () => {
    const html = linkedTable(
      ["Elektrana", "Država", "Snaga"],
      [['<a href="/x">Plomin</a>', "Hrvatska", "217 MW"]],
    );
    expect(html).toContain(
      '<tr><th scope="row"><a href="/x">Plomin</a></th><td>Hrvatska</td><td class="num">217 MW</td></tr>',
    );
  });
});
