/**
 * Pipeline tests for generatePlan (v1.4) — OpenAI is mocked so the
 * merged geometry+review repair, the targeted joints/steps repair, and
 * the re-review-on-blocker rules are exercised deterministically.
 *
 * Mock call order per run: gen → review (concurrent with validation)
 *   → [merged repair] → [re-review if a blocker was being fixed]
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock("@/lib/ai/openai", () => ({
  getOpenAI: () => ({ chat: { completions: { parse } } }),
  planModel: () => "test-plan",
  reviewModel: () => "test-review",
  reviewMode: () => "all",
  supportsTemperature: () => false,
  reasoningEffort: () => null,
}));

import { generatePlan } from "@/lib/ai/generate";
import type { PlanRequest } from "@/lib/ai/prompts/plan.v1.4";
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

function resp(json: object) {
  return {
    choices: [{ message: { content: JSON.stringify(json), parsed: json } }],
    usage: { total_tokens: 100 },
  };
}

const reviewResp = (verdict: string, issues: object[] = []) =>
  resp({ verdict, summary: `${verdict} review`, issues });

const blocker = (over: object = {}) => ({
  severity: "blocker",
  category: "joinery",
  problem: "cleats screwed across the grain of a solid top",
  fix: "use Z-clips or slotted holes",
  step: 2,
  joint_id: "J8",
  part_ids: ["P4", "P3"],
  ...over,
});

/** A bookcase whose overall height disagrees with its geometry. */
const badGeometry = {
  ...bookcasePlan,
  overall_dimensions_mm: { width: 800, depth: 292, height: 5000 },
};

describe("generatePlan pipeline (v1.4)", () => {
  beforeEach(() => parse.mockReset());

  it("emits the plan first, then runs review+merged repair for geometry errors", async () => {
    const events: string[] = [];
    parse
      .mockResolvedValueOnce(resp(badGeometry)) // gen
      .mockResolvedValueOnce(reviewResp("pass")) // review (concurrent w/ validation)
      .mockResolvedValueOnce(resp(bookcasePlan)); // merged full repair

    const r = await generatePlan(REQ, [], {}, (ev) => events.push(ev.type));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(events).toEqual(["plan", "final"]);
    expect(r.repairCount).toBe(1);
    expect(r.improved).toBe(true);
    expect(r.plan.title).toBe("5-Shelf Bookcase");
    expect(r.unverified).toEqual([]);
    expect(r.review?.verdict).toBe("pass");
    expect(parse).toHaveBeenCalledTimes(3); // gen + review + repair (no re-review: no blocker)
  });

  it("re-reviews only when a blocker was being fixed", async () => {
    parse
      .mockResolvedValueOnce(resp(bookcasePlan)) // gen (clean geometry)
      .mockResolvedValueOnce(reviewResp("fail", [blocker()]))
      .mockResolvedValueOnce(resp(bookcasePlan)) // repair
      .mockResolvedValueOnce(reviewResp("pass")); // re-review

    const r = await generatePlan(REQ, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairCount).toBe(1);
    expect(r.review?.verdict).toBe("pass");
    expect(r.unverified).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(4); // gen + review + repair + re-review
  });

  it("uses the targeted joints/steps repair for list-only issues", async () => {
    // a bookcase missing the shelf-to-side joints → touching solids, "lists" kind
    const noShelfJoints = {
      ...bookcasePlan,
      joints: bookcasePlan.joints.filter((j) => !["J1", "J2"].includes(j.id)),
    };
    const fixedJoints = bookcasePlan.joints;
    parse
      .mockResolvedValueOnce(resp(noShelfJoints)) // gen
      .mockResolvedValueOnce(reviewResp("pass")) // review
      .mockResolvedValueOnce(resp({ joints: fixedJoints, steps: bookcasePlan.steps })); // targeted

    const r = await generatePlan(REQ, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairCount).toBe(1);
    expect(r.plan.joints.map((j) => j.id)).toEqual(fixedJoints.map((j) => j.id));
    expect(r.unverified).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it("surfaces surviving review issues as unverified, minors as tips", async () => {
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
      .mockResolvedValueOnce(resp(bookcasePlan))
      .mockResolvedValueOnce(reviewResp("fail", [blocker(), minor]))
      .mockResolvedValueOnce(resp(bookcasePlan))
      .mockResolvedValueOnce(reviewResp("fail", [blocker(), minor])); // still failing

    const r = await generatePlan(REQ, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairCount).toBe(1);
    expect(r.unverified.some((u) => u.includes("cleats screwed"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("end grain"))).toBe(true);
  });

  it("returns not_buildable without repairing", async () => {
    parse.mockResolvedValueOnce(
      resp({ title: "NOT_BUILDABLE", summary: "This is a car engine, not furniture." })
    );
    const r = await generatePlan({ ...REQ, description: "rebuild my engine" }, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not_buildable");
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("returns ok with unverified when the repair still fails validation", async () => {
    parse
      .mockResolvedValueOnce(resp(badGeometry))
      .mockResolvedValueOnce(reviewResp("pass"))
      .mockResolvedValueOnce(resp(badGeometry)); // repair doesn't fix it

    const r = await generatePlan(REQ, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unverified.length).toBeGreaterThan(0);
  });
});
