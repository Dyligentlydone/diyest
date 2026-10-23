/**
 * Bookkeeping derivations (v1.4): anything that's pure arithmetic over the
 * plan is computed here, not asked of the model. Hardware totals, step
 * parts_used coverage for joints, and the consumables merge.
 */
import type { Consumable, GenPlan, HardwareItem, Plan } from "./schema";
import { canonicalTool, normalizeTools } from "@/lib/tools";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Hardware list = every joint fastener, grouped by name (+size when given),
 * qty = Σ qty_per_joint × count. Deterministic — can't drift from the joints.
 */
export function deriveHardware(joints: GenPlan["joints"]): HardwareItem[] {
  const groups = new Map<string, HardwareItem>();
  for (const j of joints) {
    for (const f of j.fasteners) {
      const key = `${norm(f.name)}|${norm(f.size ?? "")}`;
      const g = groups.get(key);
      const qty = Math.ceil(f.qty_per_joint) * j.count;
      if (g) g.qty += qty;
      else groups.set(key, { name: f.name, size: f.size, qty });
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every joint is made in a step; that step must list both joined parts in
 * parts_used (FLOOR/WALL aren't parts). Mutates a copy's steps in place.
 */
export function applyJointPartsToSteps(
  plan: Pick<Plan, "joints" | "steps" | "parts">
): void {
  const partIds = new Set(plan.parts.map((p) => p.id));
  for (const j of plan.joints) {
    const step = plan.steps.find((s) => s.n === j.step);
    if (!step) continue;
    if (partIds.has(j.part_a) && !step.parts_used.includes(j.part_a))
      step.parts_used.push(j.part_a);
    if (partIds.has(j.part_b) && !step.parts_used.includes(j.part_b))
      step.parts_used.push(j.part_b);
  }
}

/** Glue/sealant/finish list — prefers `consumables`, falls back to legacy `finishes`. */
export function consumablesOf(plan: Plan): Consumable[] {
  return plan.consumables ?? plan.finishes ?? [];
}

/**
 * Turn raw AI output into the stored plan: fix step parts_used coverage and
 * attach the derived hardware list. Call right after genPlanSchema.parse.
 */
export function finalizePlan(gen: GenPlan): Plan {
  const plan: Plan = { ...gen, hardware: deriveHardware(gen.joints) };
  applyJointPartsToSteps(plan);
  // canonical tool names so the checklist, validator and UI all speak one
  // vocabulary ("power drill" → "drill/driver")
  plan.tools = plan.tools.map((t) => ({
    ...t,
    name: canonicalTool(t.name) ?? t.name,
  }));
  for (const s of plan.steps) s.tools_used = normalizeTools(s.tools_used);
  return plan;
}
