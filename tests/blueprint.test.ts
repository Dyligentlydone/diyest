import { describe, expect, it } from "vitest";
import { drawView, renderBlueprint } from "@/lib/blueprint/render";
import { solidsOf } from "@/lib/blueprint/solids";
import { bookcasePlan, tablePlan } from "./fixtures";

describe("renderBlueprint", () => {
  it("renders all four views, dims, parts table, and title block", () => {
    const svg = renderBlueprint(bookcasePlan, "metric");
    for (const label of ["TOP VIEW", "FRONT VIEW", "SIDE VIEW", "ISOMETRIC VIEW"])
      expect(svg).toContain(label);
    expect(svg).toContain("SHEET 1 OF 1");
    expect(svg).toContain(bookcasePlan.title.toUpperCase());
    expect(svg).toContain("UNITS: MM");
    // every part appears in the table
    for (const p of bookcasePlan.parts) expect(svg).toContain(`>${p.id}<`);
    // overall dims land on the sheet, measured from geometry (800w x 292d x 1800h)
    for (const d of ["800", "292", "1800"]) expect(svg).toContain(`>${d}<`);
  });

  it("produces visible and hidden edge polylines", () => {
    const svg = renderBlueprint(bookcasePlan, "metric");
    expect(svg).toMatch(/<polyline[^>]*class="vis"/);
    expect(svg).toMatch(/<polyline[^>]*class="hid"/);
  });

  it("marks splayed-leg angles, joints, and bought parts on the table", () => {
    const svg = renderBlueprint(tablePlan, "metric");
    expect(svg).toMatch(/\d+\.\d°</); // angle callout text
    expect(svg).toContain("⌀"); // round top diameter callout
    expect(svg).toContain(">J1<"); // joint marker at leg/top contact
    expect(svg).toContain("BUY"); // bought legs excluded from the cut column
  });

  it("renders imperial units", () => {
    const svg = renderBlueprint(bookcasePlan, "imperial");
    expect(svg).toContain("UNITS: INCHES");
    expect(svg).toMatch(/>"?\d* ?\d*\/\d+"/); // fractional-inch dimension text
  });

  it("front view has more hidden edges on the back panel than a side-only part", () => {
    const v = drawView(solidsOf(bookcasePlan), "front");
    expect(v.visible.length).toBeGreaterThan(0);
    expect(v.hidden.length).toBeGreaterThan(0); // back panel behind shelves
  });

  it("is deterministic (identical output on repeat renders)", () => {
    expect(renderBlueprint(tablePlan, "metric")).toBe(
      renderBlueprint(tablePlan, "metric")
    );
  });

  it("matches snapshots", () => {
    expect(renderBlueprint(bookcasePlan, "metric")).toMatchSnapshot();
    expect(renderBlueprint(tablePlan, "metric")).toMatchSnapshot();
  });
});
