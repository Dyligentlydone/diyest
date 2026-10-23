/**
 * Pipeline tests for generatePlan (two-stage, model routing plan §3) — OpenAI
 * is mocked so stage 1 → geometry repair → stage 2 → review → merged repair →
 * re-review → escalation are exercised deterministically.
 *
 * Mock call order per run:
 *   stage1 → [stage1 geom repair] → stage2 → review (∥ validation)
 *   → [merged repair] → [re-review if a blocker was being fixed]
 *   → [escalate: stage1 → stage2 → review on AI_MODEL_ESCALATE]
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock("@/lib/ai/openai", () => ({
  getOpenAI: () => ({ chat: { completions: { parse } } }),
  planModel: () => "test-plan",
  reviewModel: () => "test-review",
  reviewMode: () => "all",
  reviewTier: () => undefined,
  escalationModel: () =>
    process.env.AI_MODEL_ESCALATE && process.env.AI_MODEL_ESCALATE !== "test-plan"
      ? process.env.AI_MODEL_ESCALATE
      : null,
  supportsTemperature: () => false,
  reasoningEffort: () => null,
}));

import { generatePlan } from "@/lib/ai/generate";
import type { PlanRequest } from "@/lib/ai/prompts/plan.v1.4";
import type { Stage1Plan, Stage2Plan } from "@/lib/ai/prompts/plan.stages";
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

/** Non-streamed calls for tests (stream path uses .create, not .parse). */
const OPTS = { stream: false };

const s1: Stage1Plan = {
  title: bookcasePlan.title,
  summary: bookcasePlan.summary,
  difficulty: bookcasePlan.difficulty,
  overall_dimensions_mm: bookcasePlan.overall_dimensions_mm,
  assumptions: bookcasePlan.assumptions,
  clarifying_questions: bookcasePlan.clarifying_questions,
  parts: bookcasePlan.parts,
  consumables: bookcasePlan.consumables ?? [],
  load_bearing: bookcasePlan.load_bearing,
};

const s2: Stage2Plan = {
  joints: bookcasePlan.joints,
  steps: bookcasePlan.steps,
  tools: bookcasePlan.tools,
  safety_overview: bookcasePlan.safety_overview,
  est_hours: bookcasePlan.est_hours,
  est_cost: bookcasePlan.est_cost,
};

function resp(json: object) {
  return {
    choices: [{ message: { content: JSON.stringify(json), parsed: json } }],
    usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 },
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

/** Stage-1 output whose overall height disagrees with its geometry. */
const badGeometryS1: Stage1Plan = {
  ...s1,
  overall_dimensions_mm: { width: 800, depth: 292, height: 5000 },
};

describe("generatePlan pipeline (two-stage)", () => {
  beforeEach(() => {
    parse.mockReset();
    delete process.env.AI_MODEL_ESCALATE;
  });

  it("runs stage1 → stage2 → review with no repairs on a clean plan", async () => {
    const events: string[] = [];
    parse
      .mockResolvedValueOnce(resp(s1))
      .mockResolvedValueOnce(resp(s2))
      .mockResolvedValueOnce(reviewResp("pass"));

    const r = await generatePlan(REQ, [], {}, (ev) => events.push(ev.type), OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(events).toEqual(["partial", "plan", "final"]);
    expect(r.repairCount).toBe(0);
    expect(r.blockers).toEqual([]);
    expect(r.unverified).toEqual([]);
    expect(r.review?.verdict).toBe("pass");
    expect(r.calls.map((c) => c.stage)).toEqual(["stage1", "stage2", "review"]);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it("repairs stage-1 geometry with a parts-only repair before stage 2", async () => {
    parse
      .mockResolvedValueOnce(resp(badGeometryS1)) // stage 1 — bad dims
      .mockResolvedValueOnce(resp({ parts: s1.parts, overall_dimensions_mm: s1.overall_dimensions_mm })) // parts repair
      .mockResolvedValueOnce(resp(s2))
      .mockResolvedValueOnce(reviewResp("pass"));

    const r = await generatePlan(REQ, [], {}, undefined, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calls.map((c) => c.stage)).toEqual([
      "stage1",
      "stage1_geomrepair",
      "stage2",
      "review",
    ]);
    expect(r.blockers).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(4);
  });

  it("uses the targeted joints/steps repair for list-only issues", async () => {
    // stage 2 missing the shelf-to-side joints → touching solids, "lists" kind
    const noShelfJoints = {
      ...s2,
      joints: s2.joints.filter((j) => !["J1", "J2"].includes(j.id)),
    };
    parse
      .mockResolvedValueOnce(resp(s1))
      .mockResolvedValueOnce(resp(noShelfJoints))
      .mockResolvedValueOnce(reviewResp("pass"))
      .mockResolvedValueOnce(resp({ joints: s2.joints, steps: s2.steps }));

    const r = await generatePlan(REQ, [], {}, undefined, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairCount).toBe(1);
    expect(r.calls.some((c) => c.stage === "repair_joints")).toBe(true);
    expect(r.plan.joints.map((j) => j.id)).toEqual(s2.joints.map((j) => j.id));
    expect(r.blockers).toEqual([]);
  });

  it("re-reviews only when a blocker was being fixed", async () => {
    parse
      .mockResolvedValueOnce(resp(s1))
      .mockResolvedValueOnce(resp(s2))
      .mockResolvedValueOnce(reviewResp("fail", [blocker()]))
      .mockResolvedValueOnce(resp({ joints: s2.joints, steps: s2.steps }))
      .mockResolvedValueOnce(reviewResp("pass"));

    const r = await generatePlan(REQ, [], {}, undefined, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairCount).toBe(1);
    expect(r.review?.verdict).toBe("pass");
    expect(r.blockers).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(5); // s1+s2+review+repair+re-review
  });

  it("escalates stages on the strong model when blockers survive repair", async () => {
    process.env.AI_MODEL_ESCALATE = "test-esc";
    parse
      .mockResolvedValueOnce(resp(s1))
      .mockResolvedValueOnce(resp(s2))
      .mockResolvedValueOnce(reviewResp("fail", [blocker()])) // review → blocker
      .mockResolvedValueOnce(resp({ joints: s2.joints, steps: s2.steps })) // repair
      .mockResolvedValueOnce(reviewResp("fail", [blocker()])) // re-review — blocker survives
      .mockResolvedValueOnce(resp(s1)) // escalate stage 1
      .mockResolvedValueOnce(resp(s2)) // escalate stage 2
      .mockResolvedValueOnce(reviewResp("pass")); // escalate review

    const r = await generatePlan(REQ, [], {}, undefined, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.escalated).toBe("test-esc");
    expect(r.blockers).toEqual([]);
    expect(r.calls.filter((c) => c.model === "test-esc").length).toBe(2);
    expect(r.calls.length).toBeGreaterThanOrEqual(7);
  });

  it("surfaces surviving blockers for the friendly 'tricky' state", async () => {
    parse
      .mockResolvedValueOnce(resp(s1))
      .mockResolvedValueOnce(resp(s2))
      .mockResolvedValueOnce(reviewResp("fail", [blocker()]))
      .mockResolvedValueOnce(resp({ joints: s2.joints, steps: s2.steps }))
      .mockResolvedValueOnce(reviewResp("fail", [blocker()])); // still failing

    const r = await generatePlan(REQ, [], {}, undefined, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blockers.some((b) => b.includes("cleats screwed"))).toBe(true);
    expect(r.unverified.some((u) => u.includes("cleats screwed"))).toBe(true);
  });

  it("returns not_buildable from stage 1 without further calls", async () => {
    parse.mockResolvedValueOnce(
      resp({ title: "NOT_BUILDABLE", summary: "This is a car engine, not furniture." })
    );
    const r = await generatePlan({ ...REQ, description: "rebuild my engine" }, [], {}, undefined, OPTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not_buildable");
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("marks reviewPending and keeps the plan when the review model fails", async () => {
    parse
      .mockResolvedValueOnce(resp(s1))
      .mockResolvedValueOnce(resp(s2))
      .mockRejectedValueOnce(new Error("sol down")) // review fails
      .mockResolvedValueOnce(reviewResp("pass")); // luna fallback

    const r = await generatePlan(REQ, [], {}, undefined, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reviewPending).toBe(true);
    expect(r.review?.model).toBe("test-plan");
    expect(r.calls.some((c) => c.stage === "review_fallback")).toBe(true);
  });
});
