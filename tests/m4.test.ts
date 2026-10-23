import { describe, expect, it } from "vitest";
import {
  ALL_TOOLS,
  canonicalTool,
  normalizeTools,
  TOOL_CATEGORIES,
} from "@/lib/tools";
import {
  buildChatMessages,
  buildDiagnosisMessage,
  buildIdeasMessage,
} from "@/lib/ai/prompts/m4";
import { checkAllowance } from "@/lib/limits";
import { buildShoppingList } from "@/lib/plan/shopping";
import { computeCutList } from "@/lib/plan/cutlist";
import { bookcasePlan } from "./fixtures";

describe("canonical tool mapping", () => {
  it("has all expected categories", () => {
    const names = TOOL_CATEGORIES.map((c) => c.name);
    expect(names).toContain("Hand tools");
    expect(names).toContain("Power tools");
    expect(names).toContain("Measuring & marking");
    expect(names).toContain("Clamping & workholding");
  });

  it("maps AI variants to canonical names", () => {
    expect(canonicalTool("Circular saw")).toBe("circular saw");
    expect(canonicalTool("skill saw")).toBe("circular saw");
    expect(canonicalTool("cordless drill")).toBe("drill/driver");
    expect(canonicalTool("random orbit sander")).toBe("orbital sander");
    expect(canonicalTool("Kreg pocket hole jig")).toBe("pocket-hole jig");
    expect(canonicalTool("measuring tape")).toBe("tape measure");
    expect(canonicalTool("bar clamp")).toBe("bar clamps");
    expect(canonicalTool("totally made up tool 3000")).toBeNull();
  });

  it("normalizeTools keeps unknowns as custom and dedupes", () => {
    const out = normalizeTools([
      "Circular saw",
      "skill saw",
      "my grandpa's froe",
      "",
    ]);
    expect(out).toEqual(["circular saw", "my grandpa's froe"]);
  });

  it("canonical names are unique across categories", () => {
    expect(new Set(ALL_TOOLS.map((t) => t.toLowerCase())).size).toBe(
      ALL_TOOLS.length
    );
  });
});

describe("M4 prompt builders", () => {
  it("ideas message (space) embeds the dimensions and fit rule", () => {
    const msg = buildIdeasMessage({
      mode: "space",
      spaceMm: { width: 900, depth: 400 },
      skillLevel: "beginner",
      units: "metric",
    });
    expect(msg).toContain("width 900");
    expect(msg).toContain("depth 400");
    expect(msg).toContain("clearance");
  });

  it("ideas message (leftovers) lists materials", () => {
    const msg = buildIdeasMessage({
      mode: "leftovers",
      materialsOwned: ["3 pallets", "plywood offcuts"],
      skillLevel: "intermediate",
      units: "imperial",
    });
    expect(msg).toContain("3 pallets");
    expect(msg).toContain("plywood offcuts");
  });

  it("diagnose message includes user description", () => {
    const msg = buildDiagnosisMessage({
      description: "drawer runner bent",
      units: "metric",
    });
    expect(msg).toContain("drawer runner bent");
  });

  it("chat messages carry plan + step context + history", () => {
    const msgs = buildChatMessages({
      planJson: '{"title":"Shelf"}',
      step: { n: 3, title: "Cut dados", text: "Mark and cut" },
      history: [{ role: "user", content: "earlier q" }],
      question: "which bit?",
      hasImage: true,
    });
    expect(msgs[0].content).toContain('"title":"Shelf"');
    expect(msgs[0].content).toContain("Cut dados");
    expect(msgs[0].content).toContain("progress photo");
    expect(msgs.at(-1)!.content).toBe("which bit?");
    expect(msgs.length).toBe(3); // ctx + history + question
  });
});

describe("allowances", () => {
  it("basic gets 0 mods, 3 chats; intermediate gets more", () => {
    expect(checkAllowance("basic", "modifications", 0).allowed).toBe(false);
    expect(checkAllowance("basic", "chatMessages", 2).allowed).toBe(true);
    expect(checkAllowance("basic", "chatMessages", 3).allowed).toBe(false);
    expect(checkAllowance("intermediate", "modifications", 2).allowed).toBe(true);
    expect(checkAllowance("intermediate", "modifications", 3).allowed).toBe(false);
    expect(checkAllowance("pro", "modifications", 999).allowed).toBe(true);
    expect(checkAllowance(null, "chatMessages", 0).allowed).toBe(true); // null → basic
  });
});

describe("leftover-material exclusion", () => {
  it("drops shopping items matching owned materials", () => {
    const cut = computeCutList(bookcasePlan);
    const full = buildShoppingList(bookcasePlan, cut);
    const filtered = buildShoppingList(bookcasePlan, cut, "metric", [
      "18mm birch plywood",
      "pine",
    ]);
    const allNames = (l: typeof full) =>
      l.sections.flatMap((s) => s.items.map((i) => i.name.toLowerCase()));
    expect(allNames(filtered).join(" ")).not.toContain("plywood");
    expect(allNames(filtered).join(" ")).not.toContain("pine");
    // hardware stays — leftovers never cover fasteners
    expect(allNames(filtered).join(" ")).toContain("screw");
    expect(filtered.estTotalUsd!).toBeLessThan(full.estTotalUsd!);
  });
});
