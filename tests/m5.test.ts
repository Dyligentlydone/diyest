import { describe, expect, it } from "vitest";
import {
  explodeSolids,
  projectPainter,
  renderExplodedSvg,
} from "@/lib/blueprint/explode";
import { renderPartSheet, templatePages, templatedParts } from "@/lib/blueprint/sheets";
import { renderBlueprint } from "@/lib/blueprint/render";
import { requestHash } from "@/lib/plan/cache";
import { solidsOf, bounds } from "@/lib/blueprint/solids";
import { bookcasePlan, tablePlan } from "./fixtures";

describe("exploded view", () => {
  const solids = solidsOf(bookcasePlan);

  it("spreads parts away from the assembly center", () => {
    const before = bounds(solids);
    const after = bounds(explodeSolids(solids, 0.3));
    const spanBefore = Math.max(
      before.hi[0] - before.lo[0],
      before.hi[1] - before.lo[1],
      before.hi[2] - before.lo[2]
    );
    const spanAfter = Math.max(
      after.hi[0] - after.lo[0],
      after.hi[1] - after.lo[1],
      after.hi[2] - after.lo[2]
    );
    expect(spanAfter).toBeGreaterThan(spanBefore);
    // factor 0 = assembled
    const same = bounds(explodeSolids(solids, 0));
    expect(same.hi[0] - same.lo[0]).toBeCloseTo(before.hi[0] - before.lo[0], 3);
  });

  it("projectPainter returns back-to-front sorted faces", () => {
    const faces = projectPainter(solids, 35, -28);
    expect(faces.length).toBeGreaterThan(0);
    for (let i = 1; i < faces.length; i++)
      expect(faces[i].depth).toBeLessThanOrEqual(faces[i - 1].depth + 1e-9);
  });

  it("renderExplodedSvg produces a labeled SVG in both variants", () => {
    for (const variant of ["blueprint", "print"] as const) {
      const svg = renderExplodedSvg(bookcasePlan, { variant });
      expect(svg).toContain("<svg");
      expect(svg).toContain("<polygon");
      expect(svg).toContain(bookcasePlan.parts[0].id);
    }
  });

  it("print blueprint variant uses dark lines on white", () => {
    const blue = renderBlueprint(tablePlan, "metric");
    const print = renderBlueprint(tablePlan, "metric", undefined, "print");
    expect(blue).toContain("#0b4f9c");
    expect(print).toContain("#ffffff");
    expect(print).not.toContain("--bp: #0b4f9c");
  });
});

describe("part sheets + templates", () => {
  it("renders a part sheet with dims", () => {
    const svg = renderPartSheet(bookcasePlan.parts[0], 2, "metric");
    expect(svg).toContain("<svg");
    expect(svg).toContain(bookcasePlan.parts[0].name);
    expect(svg).toContain("<polygon");
  });

  it("finds shaped parts for templates", () => {
    const shaped = templatedParts(bookcasePlan);
    expect(shaped.length).toBeGreaterThan(0);
    expect(shaped[0].name).toContain("kick plate");
    // tablePlan has a round top + rounded apron — both get templates
    expect(templatedParts(tablePlan).length).toBe(2);
  });

  it("tiles a large profile into labeled 1:1 pages", () => {
    const shaped = templatedParts(bookcasePlan)[0];
    const pages = templatePages(shaped, "a4");
    expect(pages.length).toBeGreaterThanOrEqual(1);
    for (const p of pages) {
      expect(p.svg).toContain('width="210mm"');
      expect(p.svg).toContain("clip-path");
      expect(p.svg).toContain(`tile ${p.label}`);
    }
  });
});

describe("plan cache", () => {
  const payload = { b: 2, a: { y: [1, 2], x: "q" } };

  it("hash is deterministic regardless of key order", () => {
    const a = requestHash({ a: { x: "q", y: [1, 2] }, b: 2 }, [], "v1");
    const b = requestHash(payload, [], "v1");
    expect(a).toBe(b);
  });

  it("hash changes with images and prompt version", () => {
    const base = requestHash(payload, [], "v1");
    expect(requestHash(payload, [], "v2")).not.toBe(base);
    expect(
      requestHash(payload, ["data:image/jpeg;base64,AAAA"], "v1")
    ).not.toBe(base);
  });
});
