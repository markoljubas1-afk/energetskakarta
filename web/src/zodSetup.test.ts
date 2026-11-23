import { describe, expect, it } from "vitest";
import { z } from "zod";

import "./zodSetup";

describe("zod in the browser", () => {
  it("never tries `new Function`, which the CSP would report", () => {
    expect(z.config().jitless).toBe(true);
    // parsing is as strict as before
    const schema = z.object({ a: z.number() });
    expect(schema.parse({ a: 1 })).toEqual({ a: 1 });
    expect(() => schema.parse({ a: "1" })).toThrow();
  });
});
