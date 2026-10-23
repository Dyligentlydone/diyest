import { describe, expect, it } from "vitest";
import { planSchema } from "@/lib/plan/schema";
import { bookcasePlan, tablePlan } from "./fixtures";

describe("planSchema", () => {
  it("parses the bookcase fixture", () => {
    const r = planSchema.safeParse(bookcasePlan);
    expect(r.success).toBe(true);
  });

  it("parses the table fixture (axis placements, profiles)", () => {
    const r = planSchema.safeParse(tablePlan);
    expect(r.success).toBe(true);
  });

  it("rejects a bad difficulty", () => {
    const r = planSchema.safeParse({ ...bookcasePlan, difficulty: "epic" });
    expect(r.success).toBe(false);
  });

  it("rejects a part with a malformed placement", () => {
    const bad = {
      ...bookcasePlan,
      parts: [
        {
          ...bookcasePlan.parts[0],
          placements: [{ x: 0, y: 0 }], // missing keys
        },
      ],
    };
    expect(planSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts an empty-parts NOT_BUILDABLE-style response shape", () => {
    const r = planSchema.safeParse({
      ...bookcasePlan,
      parts: [],
      hardware: [],
      consumables: [],
      tools: [],
      steps: [],
    });
    expect(r.success).toBe(true);
  });
});
