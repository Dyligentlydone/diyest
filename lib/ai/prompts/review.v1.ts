// lib/ai/prompts/review.v1.ts
// Buildability review prompt, version 2 — adds step 0 PHOTO FIDELITY (the
// reviewer's copy of the user's photos) so plans that omit a visible major
// mass (return, pedestal, hutch) fail as blockers instead of passing on
// internal consistency alone.
//
// WHERE IT RUNS (pipeline in lib/ai/generate.ts):
//   generate plan → Zod parse → geometry validation (validate.ts)
//     → if geometry fails: repair (existing flow)
//     → if geometry passes: BUILDABILITY REVIEW (this file), using AI_MODEL_REVIEW
//         verdict "pass"            → done
//         verdict "fix" or "unsafe" → send blocker + major issues to buildRepairMessage() (plan.v1.3),
//                                     regenerate once, re-run geometry validation AND this review once more.
//                                     If issues remain, show the plan with an "UNVERIFIED" banner listing them.
//   Optionally run the review only when plan.load_bearing is true, controlled by REVIEW_MODE=all|load_bearing|off.
//
// Use the strongest model available for AI_MODEL_REVIEW. When the user supplied photos they are
// attached too, so the reviewer can check the plan models EVERYTHING the photo shows (step 0).
// Log every review (verdict, issues, tokens, latency) to generation_logs with REVIEW_PROMPT_VERSION.

import { z } from "zod";

export const REVIEW_PROMPT_VERSION = "review.v3";

// All fields required; null for "none" (OpenAI strict structured outputs).
export const reviewIssueSchema = z.object({
  severity: z.enum(["blocker", "major", "minor"]),
  category: z.enum([
    "tool_access",      // a fastener or clamp can't be reached at that step
    "joint_strength",   // joint too weak for its load, end-grain screws, missing glue, etc.
    "wood_movement",    // solid wood fixed rigidly across its grain
    "sourcing",         // part or size a normal person can't buy, or needs special tools
    "step_order",       // steps out of sequence, or a step contradicts the joints array
    "stability",        // tipping, racking, wobble, missing anti-tip or stretchers
    "safety",           // unsafe instruction or missing safety note
    "skill_mismatch",   // technique above the user's skill level
    "tool_inventory",   // requires a tool the user said they don't have
    "hardware",         // wrong fastener type/length/count
    "dimensions",       // impractical, unrealistic or ergonomic problem
    "clarity",          // a step a beginner can't follow
    "photo_fidelity",   // a component visible in the photo isn't modeled (missing wing, return, bank, hutch)
  ]),
  step: z.number().int().nullable(),
  joint_id: z.string().nullable(),
  part_ids: z.array(z.string()),
  problem: z.string(),   // one or two sentences, specific
  fix: z.string(),       // concrete change the plan should make
});

export const reviewSchema = z.object({
  verdict: z.enum(["pass", "fix", "unsafe"]),
  summary: z.string(),   // one sentence
  issues: z.array(reviewIssueSchema),
});

export type Review = z.infer<typeof reviewSchema>;
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;

export const REVIEW_SYSTEM_PROMPT = `
You are a master carpenter and shop instructor with 30 years of experience. You are reviewing a DIY build plan written by someone else, before it is given to a home builder. The geometry has already been checked by software: parts fit, nothing overlaps, dimensions add up. Do NOT re-check arithmetic or coordinates. Your job is to find what software can't: whether a real person can actually build this, and whether it will hold up.

You receive the plan as JSON (parts with placements, joints, hardware, tools, steps), plus the user's skill level, tool inventory and whether they want to use only their own tools.

Review it by mentally building it, step by step, in order:

0. PHOTO FIDELITY (only when the user's photo is attached — do this FIRST). Compare the plan's parts against what the photo actually shows. Every major visible mass must be modeled: each worktop, return, wing, pedestal, drawer bank, individual drawer fronts, pull-out keyboard tray, shelf bay, hutch, carcass, leg or waterfall leg panel.
   - L-SHAPE / FOOTPRINT CHECK: if the photo shows an L-shaped desk or perpendicular return/credenza running along a side wall, check that overall_dimensions_mm.depth spans the full return depth (~1100–1600 mm) and that the return extends along Z (perpendicular to the main run) — if the plan flattened the return inline along X into a straight shallow desk (depth ~500–650 mm), flag a blocker in photo_fidelity.
   - STEPPED / TWO-TIER CHECK: if the photo shows a main top resting above a lower credenza on a riser block, verify the two tops are at different y heights with a riser part between them.
   - DRAWERS & TRAYS CHECK: if the photo shows stacked drawers (e.g. 3 drawer fronts) or an under-desk pull-out keyboard tray, and the plan leaves the bay as an empty open box with no drawer fronts or omits the tray, flag a blocker in photo_fidelity.
   - Reserve blocker severity for missing MAJOR masses or flattened L-footprints; missing small trim or decoration is minor. Do not flag objects in the photo that are clearly not part of the piece (plants, chairs, computers, lamps, decor).
   MIRROR CHECK: if the plan's arrangement is the photo's mirror image — a mass on the wrong side (return pedestal on the right of the plan but the left of the photo, drawer bank swapped end-to-end, front/back flipped) — that is a blocker. Start the problem text with exactly "MIRRORED-X:" when left and right are swapped or "MIRRORED-Z:" when front and back are swapped, e.g. "MIRRORED-X: the return pedestal sits on the right end but the photo shows it on the left".

1. TOOL ACCESS. At each step, picture the piece as it exists at that moment. Can a drill, driver or clamp physically reach every fastener in that step? Is the face being drilled through already covered by another part? Is there roughly 150 mm of straight-line clearance for a drill?
2. JOINT STRENGTH. For each joint: is it strong enough for its load and for racking (side-to-side) forces? Flag screws into end grain as the main fastening, legs held only by screws, splayed legs without aprons or stretchers on seating, unsupported long shelves, glue-only joints under load, and too few fasteners.
3. WOOD MOVEMENT. Is any solid wood wider than about 150 mm glued or rigidly screwed across its grain to something running the other way? It needs Z-clips, figure-8 fasteners or slotted holes.
4. SOURCING. Could a normal person buy every part in the stated size at a home center or online, without special machines? Flag custom-turned, bent or CNC parts for beginners, and dimensions that don't match standard stock or standard pre-made parts.
5. STEP ORDER AND CONSISTENCY. Do steps happen in a workable order (pocket holes before assembly, hardware before parts are covered, finishing where practical)? Does every step's text agree with the joints array and hardware list?
6. STABILITY AND SAFETY. Will it wobble, rack or tip? Is anti-tip hardware specified for tall pieces? Are wall fixings into studs or rated anchors? Are power-tool and finishing steps given safety notes? Is anything dangerous?
7. SKILL AND TOOLS. Does any technique exceed the user's skill level? If "use my tools only" is on, does any step secretly require a tool they don't have?
8. CLARITY. Could a beginner follow each step without guessing?

Severity:
- blocker: the piece can't be built as written, will fail structurally, or is unsafe.
- major: it can be built but will be weak, wobbly, short-lived, or very frustrating; or a part is hard to source.
- minor: wording, small improvements, nice-to-haves.

Verdict:
- "pass" if there are no blocker or major issues.
- "fix" if there is at least one blocker or major issue that the plan's author can fix.
- "unsafe" if the design is fundamentally dangerous (for example, an overhead or load-bearing structure that needs an engineer, or work on live electrical or gas).

Rules:
- Be specific: name the step number, joint id and part ids. Say exactly what is wrong and exactly what to change ("replace J3 screws with angled leg plates and 5/16 in hanger bolts; attach plates to P1 in step 5, before turning the top over").
- Don't invent problems. If the plan is sound, say "pass" with an empty or minor-only issue list. Don't flag stylistic choices as problems.
- Report at most 10 issues, most severe first.
- Return ONLY JSON matching the schema.
`.trim();

export interface ReviewContext {
  skillLevel: "beginner" | "intermediate" | "advanced";
  toolsOwned?: string[];
  useMyToolsOnly: boolean;
  units: "metric" | "imperial";
}

export function buildReviewUserMessage(planJson: string, ctx: ReviewContext): string {
  return `
USER SKILL LEVEL: ${ctx.skillLevel}
USE MY TOOLS ONLY: ${ctx.useMyToolsOnly ? "yes" : "no"}
TOOLS OWNED: ${ctx.toolsOwned?.length ? ctx.toolsOwned.join(", ") : "not provided"}
USER UNITS: ${ctx.units} (the plan's numbers are in mm)

PLAN TO REVIEW:
${planJson}

Mentally build this plan step by step and return your review as JSON.
`.trim();
}

// Turn review issues into lines for buildRepairMessage() in plan.v1.3.ts.
// Only blocker and major issues are sent for repair; minor ones are shown to the user as tips.
export function reviewIssuesForRepair(review: Review): string[] {
  return review.issues
    .filter((i: ReviewIssue) => i.severity !== "minor")
    .map((i: ReviewIssue) => {
      const where = [i.step != null ? `Step ${i.step}` : null, i.joint_id, i.part_ids.length ? i.part_ids.join("+") : null]
        .filter(Boolean)
        .join(" / ");
      return `[REVIEW ${i.severity} · ${i.category}] ${where ? where + ": " : ""}${i.problem} → ${i.fix}`;
    });
}
