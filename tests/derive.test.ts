import { describe, expect, it } from "vitest";
import { applyJointPartsToSteps, consumablesOf, deriveHardware } from "@/lib/plan/derive";
import { bookcasePlan, tablePlan } from "./fixtures";

describe("deriveHardware", () => {
  it("groups fasteners by name+size and sums qty_per_joint × count", () => {
    const hw = deriveHardware(bookcasePlan.joints);
    const screws = hw.find((h) => h.name === "Wood screws #8 x 38mm");
    const brads = hw.find((h) => h.name === "Brad nails 25mm");
    // J1/J2: 4 × 5 each = 40; J3/J4: 2 each = 4 → 44
    expect(screws?.qty).toBe(44);
    // J5/J6: 8 each = 16; J7: 2×5 = 10; J8: 2 → 28
    expect(brads?.qty).toBe(28);
    expect(hw).toHaveLength(2);
  });

  it("does not double-count a kit's contents", () => {
    const hw = deriveHardware(tablePlan.joints);
    const kit = hw.find((h) => /leg plate/i.test(h.name));
    expect(kit?.qty).toBe(4); // 1 per joint × 4 legs — no loose plate screws
  });

  it("matches the fixture's hardware list exactly", () => {
    const derived = deriveHardware(bookcasePlan.joints);
    for (const h of bookcasePlan.hardware) {
      const d = derived.find((x) => x.name === h.name);
      expect(d?.qty).toBe(h.qty);
    }
  });
});

describe("applyJointPartsToSteps", () => {
  it("adds joint parts to their step's parts_used", () => {
    const plan = structuredClone(bookcasePlan);
    // simulate the AI forgetting to list P4/P5 in step 2
    plan.steps[1].parts_used = ["P1", "P2", "P3"];
    applyJointPartsToSteps(plan);
    const s2 = plan.steps[1].parts_used;
    expect(s2).toContain("P4");
    expect(s2).toContain("P5");
  });
});

describe("consumablesOf", () => {
  it("prefers consumables, falls back to legacy finishes", () => {
    expect(consumablesOf(tablePlan).map((c) => c.name)).toEqual(["Danish oil"]);
    const legacy = { ...tablePlan, consumables: undefined, finishes: [{ name: "Wax" }] };
    expect(consumablesOf(legacy).map((c) => c.name)).toEqual(["Wax"]);
  });
});
