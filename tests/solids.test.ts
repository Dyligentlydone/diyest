import { describe, expect, it } from "vitest";
import { bounds, solidsOf } from "@/lib/blueprint/solids";
import { parsePath } from "@/lib/blueprint/path";
import { bookcasePlan, tablePlan } from "./fixtures";

describe("solidsOf", () => {
  it("builds one solid per placement copy", () => {
    expect(solidsOf(bookcasePlan).length).toBe(9); // 2 sides + 5 shelves + kick + back
    expect(solidsOf(tablePlan).length).toBe(6); // top + 4 legs + cleat
  });

  it("bookcase bounds match overall dimensions", () => {
    const b = bounds(solidsOf(bookcasePlan));
    expect(b.hi[0] - b.lo[0]).toBeCloseTo(800, 1);
    expect(b.hi[1] - b.lo[1]).toBeCloseTo(1800, 1);
    expect(b.hi[2] - b.lo[2]).toBeCloseTo(292, 1);
  });

  it("table bounds match overall dimensions (legs land on y=0)", () => {
    const b = bounds(solidsOf(tablePlan));
    expect(b.hi[0] - b.lo[0]).toBeCloseTo(600, 1);
    expect(b.hi[2] - b.lo[2]).toBeCloseTo(600, 1);
    expect(b.lo[1]).toBeCloseTo(0, 1);
    expect(b.hi[1]).toBeCloseTo(550, 1);
  });
});

describe("parsePath", () => {
  it("flattens the kick-plate arch into one closed loop", () => {
    const loops = parsePath("M0 0 L0 80 L762 80 L762 0 L690 0 Q381 90 72 0 Z");
    expect(loops.length).toBe(1);
    // the straight top edge sits at v=80; the arch dips below via the Q curve
    const maxV = Math.max(...loops[0].map((p) => p[1]));
    expect(maxV).toBeCloseTo(80, 3);
  });

  it("handles relative commands and H/V", () => {
    const loops = parsePath("m10 10 l40 0 l0 20 h-40 z");
    expect(loops.length).toBe(1);
    const xs = loops[0].map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(50, 3);
    expect(Math.min(...xs)).toBeCloseTo(10, 3);
  });
});
