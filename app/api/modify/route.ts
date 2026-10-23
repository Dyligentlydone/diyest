import { NextRequest, NextResponse } from "next/server";
import { denyIfNoInvite, isInviteOnly } from "@/lib/site-mode";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { planSchema } from "@/lib/plan/schema";
import { modifyPlan } from "@/lib/ai/generate";
import type { PlanRequest } from "@/lib/ai/prompts/plan.v1.8";
import { checkAllowance } from "@/lib/limits";
import { logGeneration, recordUsage } from "@/lib/usage";
import { PROMPT_VERSION } from "@/lib/ai/prompts/plan.v1.8";

const payloadSchema = z.object({
  plan: planSchema,
  kind: z.enum(["fit_space", "cheaper", "upgrade", "restyle", "custom"]),
  dims: z
    .object({
      width: z.number().positive().optional(),
      depth: z.number().positive().optional(),
      height: z.number().positive().optional(),
    })
    .optional(),
  style: z
    .enum(["rustic", "modern", "scandinavian", "industrial", "farmhouse"])
    .optional(),
  text: z.string().max(1000).optional(),
  units: z.enum(["metric", "imperial"]).default("metric"),
  skillLevel: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  currency: z.string().length(3).default("USD"),
  /** saved project → counter increments + plan row updates */
  projectId: z.string().uuid().optional(),
});

const RESTYLES: Record<string, string> = {
  rustic: "rustic farmhouse — visible grain, chunky proportions, warm stain",
  modern: "clean modern — minimal lines, flush surfaces, matte finish",
  scandinavian: "Scandinavian — light wood, simple functional forms, tapered legs",
  industrial: "industrial — dark metal + reclaimed wood look, exposed fasteners",
  farmhouse: "farmhouse — painted + stained mix, classic country details",
};

function instructionFor(b: z.infer<typeof payloadSchema>): string | null {
  switch (b.kind) {
    case "fit_space": {
      const d = b.dims;
      if (!d?.width && !d?.depth && !d?.height) return null;
      const dims = [
        d.width != null ? `width ${d.width} mm` : null,
        d.depth != null ? `depth ${d.depth} mm` : null,
        d.height != null ? `height ${d.height} mm` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `Resize this project to fit inside a space of ${dims}. Keep the design's character — rescale dimensions and part sizes proportionally, adjust shelves/parts that no longer fit, and update overall_dimensions_mm.`;
    }
    case "cheaper":
      return "Make this build meaningfully cheaper: swap hardwoods/plywood for pine, spruce or MDF; prefer standard fasteners over specialty hardware; simplify joinery where the skill level allows. Keep it safe and sturdy. Note every trade-off in assumptions.";
    case "upgrade":
      return "Upgrade materials and build quality: hardwood or hardwood plywood, better joinery (where the skill level allows) and quality hardware/finish. Keep the same overall dimensions and function; note the changes in assumptions.";
    case "restyle": {
      const style = RESTYLES[b.style ?? ""] ?? b.style;
      if (!style) return null;
      return `Restyle this project to a ${style} look — same function and roughly the same build complexity, but change materials, proportions, details and finish to match the style. Update the title and summary to reflect the new look.`;
    }
    case "custom":
      return b.text?.trim() || null;
  }
}

/** POST — apply a quick modifier to a plan (validate → review → repair). */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isInviteOnly()) {
    if (!user)
      return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
    const denied = await denyIfNoInvite(user.id);
    if (denied) return denied;
  }

  let body: z.infer<typeof payloadSchema>;
  try {
    body = payloadSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const instruction = instructionFor(body);
  if (!instruction)
    return NextResponse.json(
      { error: "Nothing to modify — give a dimension, style or instruction" },
      { status: 400 }
    );

  // per-plan allowance (soft until M6 enforcement — counters tracked now)
  let accessLevel: "basic" | "intermediate" | "pro" = "basic";
  let modsUsed = 0;
  if (body.projectId && user) {
    const { data: proj } = await supabase
      .from("projects")
      .select("access_level, modifications_used")
      .eq("id", body.projectId)
      .maybeSingle();
    if (proj) {
      accessLevel = (proj.access_level as typeof accessLevel) ?? "basic";
      modsUsed = proj.modifications_used ?? 0;
    }
  }
  const check = checkAllowance(accessLevel, "modifications", modsUsed);

  const req: PlanRequest = {
    mode: "build",
    units: body.units,
    skillLevel: body.skillLevel,
    budget: "balanced",
    style: "match_photo",
    useMyToolsOnly: false,
    currency: body.currency,
    imageCount: 0,
  };
  const ctx =
    body.kind === "fit_space" && body.dims
      ? { targetDimensionsMm: body.dims }
      : {};

  const result = await modifyPlan(body.plan, instruction, req, ctx);
  for (const c of result.calls)
    void logGeneration({
      user_id: user?.id,
      project_id: body.projectId,
      prompt_version: PROMPT_VERSION,
      stage: c.stage,
      model: c.model,
      tier: c.tier,
      input_tokens: c.usage.inputTokens,
      cached_tokens: c.usage.cachedTokens,
      output_tokens: c.usage.outputTokens,
      reasoning_tokens: c.usage.reasoningTokens,
      cost_usd: c.costUsd,
      latency_ms: c.latencyMs,
      tokens: c.usage.inputTokens + c.usage.outputTokens,
      validation_errors: result.blockers.length ? { blockers: result.blockers } : undefined,
    });

  if (!result.ok || !result.plan)
    return NextResponse.json(
      { error: result.error ?? "Modification failed" },
      { status: 422 }
    );

  if (user) void recordUsage(user.id, "plan_modify");
  if (body.projectId && user)
    void supabase
      .from("projects")
      .update({
        plan: result.plan,
        modifications_used: modsUsed + 1,
      })
      .eq("id", body.projectId);

  return NextResponse.json({
    ok: true,
    plan: result.plan,
    unverified: result.unverified,
    blockers: result.blockers,
    warnings: result.warnings,
    reviewPending: result.reviewPending,
    changedSteps: result.changedSteps,
    usage: {
      kind: "modifications",
      ...check,
      used: modsUsed + 1,
      remaining: Math.max(0, check.limit - modsUsed - 1),
    },
  });
}
