/**
 * Pipeline tests for generatePlan — OpenAI is mocked so the geometry-repair
 * and review-repair paths can be forced deterministically.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock("@/lib/ai/openai", () => ({
  getOpenAI: () => ({ chat: { completions: { parse } } }),
  planModel: () => "test-plan",
  reviewModel: () => "test-review",
  reviewMode: () => "all",
  supportsTemperature: () => false,
}));

import { generatePlan } from "@/lib/ai/generate";
import type { PlanRequest } from "@/lib/ai/prompts/plan.v1.3";
import type { Plan } from "@/lib/plan/schema";
import { bookcasePlan } from "./fixtures";

const REQ: PlanRequest = {
  mode: "build",
  description: "a bookcase",
  units: "metric",
  skillLevel: "intermediate",
  budget: "balanced",
  style: "modern",
  useMyToolsOnly: false,
  currency: "USD",
  imageCount: 0,
};

function planResp(plan: Plan | object) {
  return {
    choices: [{ message: { content: JSON.stringify(plan), parsed: plan } }],
    usage: { total_tokens: 100 },
  };
}

function reviewResp(verdict: string, issues: object[] = []) {
  const review = { verdict, summary: `${verdict} review`, issues };
  return {
    choices: [{ message: { content: JSON.stringify(review), parsed: review } }],
    usage: { total_tokens: 50 },
  };
}

describe("generatePlan pipeline", () => {
  beforeEach(() => parse.mockReset());

  it("repairs once when the first plan fails geometry validation", async () => {
    const bad = {
      ...bookcasePlan,
      overall_dimensions_mm: { width: 800, depth: 292, height: 5000 }, // vs 1800 built
    };
    parse
      .mockResolvedValueOnce(planResp(bad))
      .mockResolvedValueOnce(planResp(bookcasePlan))
      .mockResolvedValueOnce(reviewResp("pass"));

    const r = await generatePlan(REQ, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairCount).toBe(1);
    expect(r.plan.title).toBe("5-Shelf Bookcase");
    expect(r.unverified).toEqual([]);
    expect(r.review?.verdict).toBe("pass");
    expect(parse).toHaveBeenCalledTimes(3); // gen + repair + review
  });

  it("repairs on blocker review issues, then re-validates and re-reviews", async () => {
    const blocker = {
      severity: "blocker",
      category: "joinery",
      problem: "cleats screwed across the grain of a solid top",
      fix: "use Z-clips or slotted holes",
      step: 2,
      joint_id: "J2",
      part_ids: ["P3", "P1"],
    };
    parse
      .mockResolvedValueOnce(planResp(bookcasePlan))
      .mockResolvedValueOnce(reviewResp("fail", [blocker]))
      .mockResolvedValueOnce(planResp(bookcasePlan))
      .mockResolvedValueOnce(reviewResp("pass"));

    const r = await generatePlan(REQ, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairCount).toBe(1);
    expect(r.review?.verdict).toBe("pass");
    expect(r.unverified).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(4); // gen + review + repair + re-review
  });

  it("surfaces surviving review issues as unverified, minors as tips", async () => {
    const blocker = {
      severity: "blocker",
      category: "strength",
      problem: "shelf span will sag",
      fix: "add a center divider",
      step: null,
      joint_id: null,
      part_ids: ["P3"],
    };
    const minor = {
      severity: "minor",
      category: "finish",
      problem: "end grain will drink finish",
      fix: "seal end grain first",
      step: null,
      joint_id: null,
      part_ids: ["P1"],
    };
    parse
      .mockResolvedValueOnce(planResp(bookcasePlan))
      .mockResolvedValueOnce(reviewResp("fail", [blocker, minor]))
      .mockResolvedValueOnce(planResp(bookcasePlan))
      .mockResolvedValueOnce(reviewResp("fail", [blocker, minor])); // still failing after repair

    const r = await generatePlan(REQ, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairCount).toBe(1);
    expect(r.unverified.some((u) => u.includes("shelf span will sag"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("end grain"))).toBe(true);
  });

  it("returns not_buildable without repairing", async () => {
    parse.mockResolvedValueOnce(
      planResp({ title: "NOT_BUILDABLE", summary: "This is a car engine, not furniture." })
    );
    const r = await generatePlan(
      { ...REQ, description: "rebuild my motorcycle engine" },
      []
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not_buildable");
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("returns invalid when the repaired plan still fails validation", async () => {
    const bad = {
      ...bookcasePlan,
      overall_dimensions_mm: { width: 800, depth: 292, height: 5000 },
    };
    parse
      .mockResolvedValueOnce(planResp(bad))
      .mockResolvedValueOnce(planResp(bad));

    const r = await generatePlan(REQ, []);
    expect(r.ok).toBe(true); // plan parses but still fails validation → unverified
    if (!r.ok) return;
    expect(r.unverified.length).toBeGreaterThan(0);
  });
});
