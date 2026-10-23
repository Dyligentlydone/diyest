import { describe, expect, it } from "vitest";
import { validatePlan } from "@/lib/plan/validate";
import { bookcasePlan, tablePlan } from "./fixtures";
import type { Plan } from "@/lib/plan/schema";

const clone = (p: Plan): Plan => JSON.parse(JSON.stringify(p));

describe("validatePlan — valid fixtures", () => {
  it("bookcase: no errors", async () => {
    const r = await validatePlan(bookcasePlan);
    expect(r.errors).toEqual([]);
  });

  it("table: no errors (splayed tapered legs)", async () => {
    const r = await validatePlan(tablePlan);
    expect(r.errors).toEqual([]);
  });
});

describe("validatePlan — catches inconsistencies", () => {
  it("placements.length !== qty", async () => {
    const p = clone(bookcasePlan);
    p.parts[2].qty = 4; // has 5 placements
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("placements.length"))).toBe(true);
  });

  it("box size mismatch vs part dims", async () => {
    const p = clone(bookcasePlan);
    p.parts[2].placements = p.parts[2].placements.map((pl) => ({ ...pl, sx: 700 }));
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("≠ part dims"))).toBe(true);
  });

  it("axis length mismatch", async () => {
    const p = clone(tablePlan);
    p.parts[1].length_mm = 600; // real centerline is ~533
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("axis length"))).toBe(true);
  });

  it("profile path leaving its box", async () => {
    const p = clone(bookcasePlan);
    p.parts[3].profile = { type: "path", d: "M0 0 L0 80 L900 80 L900 0 Z" }; // 900 > 762
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("leaves its"))).toBe(true);
  });

  it("floating part", async () => {
    const p = clone(bookcasePlan);
    // detached in front of the case — touches nothing and isn't on the floor
    p.parts[2].placements[0] = { x: 19, y: 400, z: 400, sx: 762, sy: 19, sz: 286 };
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("floats"))).toBe(true);
  });

  it("overlapping solids (real mesh intersection)", async () => {
    const p = clone(bookcasePlan);
    p.parts[2].placements[0] = { x: 0, y: 80, z: 0, sx: 762, sy: 19, sz: 286 };
    // now overlaps the left side by 19mm: 19×19×286 ≈ 103k mm³
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("Solids intersect"))).toBe(true);
  });

  it("intersection explained by joinery notes is allowed", async () => {
    const p = clone(bookcasePlan);
    p.parts[2].placements[0] = { x: 0, y: 80, z: 0, sx: 762, sy: 19, sz: 286 };
    p.parts[2].notes = "Ends housed in 19mm dados in the sides.";
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("Solids intersect"))).toBe(false);
  });

  it("unknown part id in a step", async () => {
    const p = clone(bookcasePlan);
    p.steps[0].parts_used.push("P99");
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("P99"))).toBe(true);
  });

  it("part not used in any step", async () => {
    const p = clone(bookcasePlan);
    p.steps = p.steps.map((s) => ({
      ...s,
      parts_used: s.parts_used.filter((id) => id !== "P5"),
    }));
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("P5"))).toBe(true);
  });

  it("target dimensions off by >5%", async () => {
    const r = await validatePlan(bookcasePlan, {
      targetDimensionsMm: { width: 1000, height: 1800 },
    });
    expect(r.errors.some((e) => e.includes("width"))).toBe(true);
  });

  it("use-my-tools-only violation", async () => {
    const r = await validatePlan(bookcasePlan, {
      useMyToolsOnly: true,
      toolsOwned: ["Drill/driver"],
    });
    expect(r.errors.some((e) => e.includes("Circular saw"))).toBe(true);
  });

  it("level-end leg not reaching the floor", async () => {
    const p = clone(tablePlan);
    p.parts[1].placements = p.parts[1].placements.map((pl) =>
      "from" in pl ? { ...pl, to: [pl.to[0], 50, pl.to[2]] as [number, number, number] } : pl
    );
    p.parts[1].length_mm = Math.hypot(64, 475, 64); // keep length consistent
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("reaches the floor"))).toBe(true);
  });

  it("bounding box ≠ overall dimensions", async () => {
    const p = clone(bookcasePlan);
    p.overall_dimensions_mm.width = 900;
    const r = await validatePlan(p);
    expect(r.errors.some((e) => e.includes("Bounding box"))).toBe(true);
  });
});
