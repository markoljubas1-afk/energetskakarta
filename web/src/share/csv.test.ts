import { describe, expect, it } from "vitest";

import { csvFileName, toCsv } from "./csv";

describe("CSV", () => {
  it("quotes what needs quoting, leaves numbers plain and missing values empty", () => {
    expect(
      toCsv({
        header: ["Razdoblje", "Hidro (MWh)", 'Napomena "x"'],
        rows: [
          ["2026-03", 1234.5, null],
          ["2026-04", 0.000001, "a, b"],
          ["2026-05", Number.NaN, "dva\nretka"],
        ],
      }),
    ).toBe(
      'Razdoblje,Hidro (MWh),"Napomena ""x"""\r\n2026-03,1234.5,\r\n2026-04,0.000001,"a, b"\r\n2026-05,,"dva\nretka"\r\n',
    );
  });

  it("names the file in ASCII with the date", () => {
    expect(csvFileName("Proizvodnja · Hrvatska, mjesečno (Đakovo)", new Date(2026, 10, 15, 9))).toBe(
      "proizvodnja-hrvatska-mjesecno-dakovo-2026-11-15.csv",
    );
  });
});
