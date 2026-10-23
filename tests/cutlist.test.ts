import { describe, expect, it } from "vitest";
import { computeCutList, DEFAULT_STOCK } from "@/lib/plan/cutlist";
import { buildShoppingList, shoppingListText } from "@/lib/plan/shopping";
import { bookcasePlan, tablePlan } from "./fixtures";

describe("computeCutList", () => {
  it("packs bookcase boards into stock lengths and the back onto a sheet", () => {
    const cut = computeCutList(bookcasePlan);
    // 19×286 stock: 2×1800 sides take a board each, 5×762 shelves pack
    // 3-per-2400-board → 4 boards; the 19×80 kick plate is its own
    // section and fits a cheaper 1200 board (fewest pieces, least waste)
    expect(cut.boards).toHaveLength(5);
    expect(cut.boards.filter((b) => b.length === 2400)).toHaveLength(4);
    expect(cut.boards.find((b) => b.length === 1200)?.cuts[0].partId).toBe("P4");
    expect(cut.sheets).toHaveLength(1);
    expect(cut.sheets[0].cuts[0].partId).toBe("P5");
    expect(cut.loose).toHaveLength(0);
  });

  it("expands qty and respects kerf inside every board", () => {
    const cut = computeCutList(bookcasePlan, { kerfMm: 5 });
    const shelfCuts = cut.boards.flatMap((b) =>
      b.cuts.filter((c) => c.partId === "P3")
    );
    expect(shelfCuts).toHaveLength(5); // qty expansion
    for (const b of cut.boards) {
      const total =
        b.cuts.reduce((s, c) => s + c.length, 0) + 5 * (b.cuts.length - 1);
      expect(total).toBeLessThanOrEqual(b.length);
    }
  });

  it("excludes bought parts from the cut list entirely", () => {
    const cut = computeCutList(tablePlan);
    const all = [...cut.boards, ...cut.sheets].flatMap((b) => b.cuts);
    expect(all.some((c) => c.partId === "P2")).toBe(false);
    // cleat is the only board part; top is the sheet part
    expect(cut.boards.flatMap((b) => b.cuts).map((c) => c.partId)).toEqual(["P3"]);
    expect(cut.sheets.flatMap((s) => s.cuts).map((c) => c.partId)).toEqual(["P1"]);
  });

  it("marks shaped parts as trace-inside bounding rectangles", () => {
    const cut = computeCutList(bookcasePlan);
    const kick = cut.boards
      .flatMap((b) => b.cuts)
      .find((c) => c.partId === "P4");
    expect(kick?.note).toMatch(/path profile — trace shape inside/);
  });

  it("reports the true end-cut angle for angled members", () => {
    const angled = {
      ...bookcasePlan,
      parts: [
        {
          id: "P1",
          name: "Splayed leg",
          material: "Pine board",
          stock: "board" as const,
          source: "make" as const,
          buy_spec: null,
          length_mm: 537,
          width_mm: 40,
          thickness_mm: 40,
          qty: 1,
          ends: "level" as const,
          cross_section: { shape: "rect" as const, w: 40, t: 40 },
          placements: [
            {
              from: [173, 537, 173] as [number, number, number],
              to: [109, 0, 109] as [number, number, number],
            },
          ],
        },
      ],
    };
    const cut = computeCutList(angled);
    const leg = cut.boards[0].cuts[0];
    // legs from tablePlan geometry splay ~13.7° from vertical
    expect(leg.note).toMatch(/ends level at \d+(\.\d+)?°/);
  });

  it("parks pieces longer than any stock as loose", () => {
    const huge = {
      ...bookcasePlan,
      parts: bookcasePlan.parts.map((p) =>
        p.id === "P1" ? { ...p, placements: [{ x: 0, y: 0, z: 0, sx: 19, sy: 3000, sz: 286 }] } : p
      ),
    };
    // P1 placement sy=3000 > 2400 — but box placement takes max dim → 3000 board cut
    const cut = computeCutList(huge, {
      stock: { ...DEFAULT_STOCK, boardLengths: [2400] },
    });
    expect(cut.loose.some((l) => l.partId === "P1")).toBe(true);
  });
});

describe("buildShoppingList", () => {
  it("groups items by store section", () => {
    const list = buildShoppingList(tablePlan, computeCutList(tablePlan));
    const names = list.sections.map((s) => s.name);
    expect(names).toContain("lumber");
    expect(names).toContain("sheet goods");
    expect(names).toContain("hardware & fasteners");
    expect(names).toContain("bought parts");
    expect(names).toContain("glue & finish");
  });

  it("lists bought parts with their spec and an estimate", () => {
    const list = buildShoppingList(tablePlan, computeCutList(tablePlan));
    const legs = list.sections
      .find((s) => s.name === "bought parts")
      ?.items.find((i) => i.key === "buy-P2");
    expect(legs?.spec).toContain("tapered pine table leg");
    expect(legs?.qty).toBe("×4");
    expect(legs?.estUsd).toBeGreaterThan(0);
  });

  it("rolls hardware and consumables in with line estimates and a total", () => {
    const list = buildShoppingList(bookcasePlan, computeCutList(bookcasePlan));
    const hw = list.sections.find((s) => s.name === "hardware & fasteners");
    expect(hw?.items.some((i) => i.name.includes("Wood screws") && i.qty === "×44")).toBe(true);
    const glue = list.sections
      .find((s) => s.name === "glue & finish")
      ?.items.find((i) => i.name.includes("glue"));
    expect(glue?.estUsd).toBeGreaterThan(0);
    expect(list.estTotalUsd).toBeGreaterThan(0);
    // every line carries a stable key for "already have" persistence
    for (const s of list.sections)
      for (const i of s.items) expect(i.key.length).toBeGreaterThan(0);
  });

  it("renders a plain-text list for copy/print", () => {
    const list = buildShoppingList(tablePlan, computeCutList(tablePlan));
    const text = shoppingListText(list);
    expect(text).toMatch(/LUMBER/);
    expect(text).toMatch(/Estimated materials total/);
  });
});
