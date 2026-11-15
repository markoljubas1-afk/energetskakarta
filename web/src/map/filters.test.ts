import { expression } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";

import { voltageClass } from "../domain";
import { voltageClassExpr } from "./filters";

/** The same question is answered twice: once in TypeScript for the legend and the details panel, once as
 * a MapLibre expression for colours and filters. They must never drift apart. */
describe("voltageClassExpr", () => {
  const compiled = expression.createExpression(voltageClassExpr, "voltageClassExpr");
  if (compiled.result === "error") throw new Error(compiled.value.map((e) => e.message).join("; "));
  const evaluate = (maxVoltageKv: number | null): unknown =>
    compiled.value.evaluate({ zoom: 5 }, {
      type: "Point",
      properties: maxVoltageKv === null ? {} : { maxVoltageKv },
    } as never);

  it.each([null, 0.4, 10, 20, 35, 59.9, 60, 110, 219, 220, 379, 380, 400, 750])(
    "agrees with voltageClass() for %s kV",
    (kv) => {
      expect(evaluate(kv)).toBe(voltageClass(kv));
    },
  );
});
