/**
 * Plan generation orchestrator (plan.v1.4 + review.v1), progressive:
 *
 *   generate → parse+finalize → EMIT "plan" (UI shows it ~immediately)
 *   → geometry validation ∥ buildability review (concurrent)
 *   → ONE repair covering both issue sets (targeted joints+steps repair
 *     when every issue is list-class, else full plan repair)
 *   → re-validate; re-review ONLY if a blocker was being fixed
 *   → EMIT "final" (with `improved` when a repair landed)
 *
 * Bookkeeping is code-side (lib/plan/derive.ts): hardware totals and
 * step parts_used coverage are never asked of the model.
 * Server-side only — never import from client components.
 */
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  buildJointRepairMessage,
  buildPlanUserMessage,
  buildRepairMessage,
  jointRepairSchema,
  PLAN_SYSTEM_PROMPT,
  PROMPT_VERSION,
  type JointRepair,
  type PlanRequest,
} from "./prompts/plan.v1.4";
import {
  buildReviewUserMessage,
  REVIEW_SYSTEM_PROMPT,
  reviewIssuesForRepair,
  reviewSchema,
  type Review,
} from "./prompts/review.v1";
import {
  getOpenAI,
  planModel,
  reasoningEffort,
  reviewMode,
  reviewModel,
  supportsTemperature,
} from "./openai";
import {
  genPlanSchema,
  NOT_BUILDABLE_TITLE,
  type GenPlan,
  type Plan,
} from "@/lib/plan/schema";
import { finalizePlan } from "@/lib/plan/derive";
import { validatePlan, type ValidationResult } from "@/lib/plan/validate";

export interface ReviewInfo {
  verdict: Review["verdict"];
  summary: string;
  issues: Review["issues"];
  model: string;
  latencyMs: number;
  tokens: number;
}

export interface GenerateSuccess {
  ok: true;
  plan: Plan;
  /** consistency/buildability issues that survived repair — show on the plan */
  unverified: string[];
  warnings: string[];
  promptVersion: string;
  model: string;
  latencyMs: number;
  /** ms from call start until the first viewable plan existed */
  firstPlanMs: number;
  tokens: number;
  /** number of repair passes that ran (merged geometry + review) */
  repairCount: number;
  /** true when a repair pass produced a better plan than the first draft */
  improved: boolean;
  review: ReviewInfo | null;
  raw: string;
}

export type GenerateError =
  | { ok: false; kind: "not_buildable"; summary: string; raw: string }
  | { ok: false; kind: "invalid"; errors: string[]; raw: string };

export type GenerateResult = GenerateSuccess | GenerateError;

/** Progressive events for streaming UIs (NDJSON on /api/generate). */
export type GenEvent =
  | {
      type: "plan";
      plan: Plan;
      unverified: string[];
      warnings: string[];
      promptVersion: string;
      firstPlanMs: number;
    }
  | { type: "final"; result: GenerateSuccess }
  | { type: "error"; result: GenerateError };

async function callModel<T>(
  messages: ChatCompletionMessageParam[],
  imageDataUrls: string[],
  schemaName: string,
  schema: Parameters<typeof zodResponseFormat>[0],
  model = planModel()
): Promise<{ raw: string; parsed: T | null; latencyMs: number; tokens: number }> {
  const start = Date.now();

  const withImages = messages.map((m) => {
    if (m.role !== "user" || !imageDataUrls.length || Array.isArray(m.content)) return m;
    return {
      ...m,
      content: [
        { type: "text" as const, text: m.content as string },
        ...imageDataUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url, detail: "high" as const },
        })),
      ],
    };
  });

  const effort = reasoningEffort(model);
  const completion = await getOpenAI().chat.completions.parse({
    model,
    messages: withImages,
    response_format: zodResponseFormat(schema, schemaName),
    ...(supportsTemperature(model) ? { temperature: 0.3 } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
  });

  return {
    raw: completion.choices[0]?.message?.content ?? "",
    parsed: (completion.choices[0]?.message?.parsed ?? null) as T | null,
    latencyMs: Date.now() - start,
    tokens: completion.usage?.total_tokens ?? 0,
  };
}

/** Buildability review — JSON only, no images, on AI_MODEL_REVIEW. */
async function callReview(planJson: string, req: PlanRequest): Promise<ReviewInfo> {
  const model = reviewModel();
  const start = Date.now();
  const completion = await getOpenAI().chat.completions.parse({
    model,
    messages: [
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildReviewUserMessage(planJson, {
          skillLevel: req.skillLevel,
          toolsOwned: req.toolsOwned,
          useMyToolsOnly: req.useMyToolsOnly,
          units: req.units,
        }),
      },
    ],
    response_format: zodResponseFormat(reviewSchema, "review"),
    ...(supportsTemperature(model) ? { temperature: 0.2 } : {}),
    ...(reasoningEffort(model) ? { reasoning_effort: reasoningEffort(model)! } : {}),
  });
  const parsed = completion.choices[0]?.message?.parsed as Review | null;
  return {
    verdict: parsed?.verdict ?? "pass",
    summary: parsed?.summary ?? "",
    issues: parsed?.issues ?? [],
    model,
    latencyMs: Date.now() - start,
    tokens: completion.usage?.total_tokens ?? 0,
  };
}

interface ParsedAttempt {
  plan: Plan | null;
  parseErrors: string[];
}

function tryParse(raw: string): ParsedAttempt {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { plan: null, parseErrors: ["Response was not valid JSON"] };
  }
  const title = (json as { title?: unknown })?.title;
  if (title === NOT_BUILDABLE_TITLE) return { plan: null, parseErrors: [] };

  const result = genPlanSchema.safeParse(json);
  if (!result.success) {
    return {
      plan: null,
      parseErrors: result.error.issues
        .slice(0, 20)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  // finalize: derive hardware from joints, add joint parts to step parts_used
  return { plan: finalizePlan(result.data as GenPlan), parseErrors: [] };
}

function isNotBuildable(raw: string): { summary: string } | null {
  try {
    const j = JSON.parse(raw) as { title?: string; summary?: string };
    if (j.title === NOT_BUILDABLE_TITLE)
      return { summary: j.summary ?? "This doesn't look like a buildable project." };
  } catch {
    /* fall through */
  }
  return null;
}

/** Review issues that are joint/step-scoped → fixable by the targeted repair. */
function jointScoped(i: Review["issues"][number]): boolean {
  return i.joint_id != null || i.step != null;
}

export async function generatePlan(
  req: PlanRequest,
  imageDataUrls: string[],
  ctx: Parameters<typeof validatePlan>[1] = {},
  emit?: (ev: GenEvent) => void
): Promise<GenerateResult> {
  const t0 = Date.now();
  const model = planModel();
  const userMessage = buildPlanUserMessage({ ...req, imageCount: imageDataUrls.length });
  const genMessages = (extra: ChatCompletionMessageParam[] = []): ChatCompletionMessageParam[] => [
    { role: "system", content: PLAN_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
    ...extra,
  ];
  const fail = (r: GenerateError): GenerateResult => {
    emit?.({ type: "error", result: r });
    return r;
  };

  // ---- attempt 1 ----
  const first = await callModel<Plan>(genMessages(), imageDataUrls, "plan", genPlanSchema);
  let raw = first.raw;
  let latencyMs = first.latencyMs;
  let tokens = first.tokens;
  let repairCount = 0;
  let improved = false;

  const nb = isNotBuildable(raw);
  if (nb) return fail({ ok: false, kind: "not_buildable", summary: nb.summary, raw });

  let attempt = tryParse(raw);
  let validation: ValidationResult = { errors: attempt.parseErrors, warnings: [], issues: [] };
  let review: ReviewInfo | null = null;
  let firstPlanMs: number | null = null;

  if (attempt.plan) {
    firstPlanMs = Date.now() - t0;
    emit?.({
      type: "plan",
      plan: attempt.plan,
      unverified: attempt.parseErrors,
      warnings: [],
      promptVersion: PROMPT_VERSION,
      firstPlanMs,
    });
    // geometry validation ∥ buildability review — concurrent, always both
    const mode = reviewMode();
    const shouldReview =
      mode === "all" || (mode === "load_bearing" && attempt.plan.load_bearing);
    const [v, r] = await Promise.all([
      validatePlan(attempt.plan, ctx),
      shouldReview ? callReview(raw, req) : Promise.resolve(null),
    ]);
    validation = v;
    validation.errors = [...attempt.parseErrors, ...v.errors];
    review = r;
    if (r) {
      latencyMs += r.latencyMs;
      tokens += r.tokens;
    }
  }

  // ---- ONE merged repair pass (geometry + review issues together) ----
  const reviewLines = review ? reviewIssuesForRepair({ verdict: review.verdict, summary: "", issues: review.issues } as Review) : [];
  const mergedIssues = [...validation.errors, ...reviewLines];
  const hadBlocker = review?.issues.some((i) => i.severity === "blocker") ?? false;

  // repair when the plan has issues OR there is no usable plan at all
  if (attempt.plan ? mergedIssues.length > 0 : true) {
    repairCount++;
    // targeted joints+steps repair when nothing needs geometry changes
    const geometryDirty = !attempt.plan || validation.issues.some((i) => i.kind === "geometry");
    const reviewJointScoped =
      review == null || review.issues.filter((i) => i.severity !== "minor").every(jointScoped);
    const targeted = !geometryDirty && reviewJointScoped;

    if (targeted) {
      const rep = await callModel<JointRepair>(
        genMessages([
          { role: "assistant", content: raw },
          { role: "user", content: buildJointRepairMessage(raw, mergedIssues) },
        ]),
        imageDataUrls,
        "joint_repair",
        jointRepairSchema
      );
      latencyMs += rep.latencyMs;
      tokens += rep.tokens;
      const fix = rep.parsed;
      const current = attempt.plan;
      if (fix?.joints && fix?.steps && current) {
        const merged = {
          ...current,
          consumables: current.consumables ?? [],
          joints: fix.joints,
          steps: fix.steps,
        } as GenPlan;
        attempt = { plan: finalizePlan(merged), parseErrors: [] };
      }
      raw = rep.raw || raw;
    } else {
      const rep = await callModel<Plan>(
        genMessages([
          { role: "assistant", content: raw },
          { role: "user", content: buildRepairMessage(raw, mergedIssues) },
        ]),
        imageDataUrls,
        "plan",
        genPlanSchema
      );
      raw = rep.raw || raw;
      latencyMs += rep.latencyMs;
      tokens += rep.tokens;

      const nb2 = isNotBuildable(raw);
      if (nb2) return fail({ ok: false, kind: "not_buildable", summary: nb2.summary, raw });
      attempt = tryParse(raw);
    }

    if (attempt.plan) {
      validation = await validatePlan(attempt.plan, ctx);
      validation.errors = [...attempt.parseErrors, ...validation.errors];
      improved = !validation.errors.length || mergedIssues.length > validation.errors.length;
      if (firstPlanMs == null) {
        firstPlanMs = Date.now() - t0;
        emit?.({
          type: "plan",
          plan: attempt.plan,
          unverified: validation.errors,
          warnings: validation.warnings,
          promptVersion: PROMPT_VERSION,
          firstPlanMs,
        });
      }
    } else {
      validation = { errors: ["Repair returned an unusable plan"], warnings: [], issues: [] };
    }
  }

  // If the first attempt never parsed, we still owe the review+repair cycle
  // a review of whatever plan we ended with.
  if (!attempt.plan) {
    return fail({ ok: false, kind: "invalid", errors: validation.errors, raw });
  }

  // ---- re-review only when a blocker was being fixed ----
  if (hadBlocker && repairCount > 0 && !validation.errors.length) {
    const re = await callReview(JSON.stringify(attempt.plan), req);
    latencyMs += re.latencyMs;
    tokens += re.tokens;
    review = re;
  } else if (!review) {
    // review was skipped earlier only when plan didn't parse — run it now
    const mode = reviewMode();
    if (mode === "all" || (mode === "load_bearing" && attempt.plan.load_bearing)) {
      review = await callReview(JSON.stringify(attempt.plan), req);
      latencyMs += review.latencyMs;
      tokens += review.tokens;
    }
  }

  const unverified = [...validation.errors];
  if (review && review.verdict !== "pass")
    unverified.push(
      ...reviewIssuesForRepair({
        verdict: review.verdict,
        summary: review.summary,
        issues: review.issues,
      } as Review)
    );

  const tips =
    review?.issues
      .filter((i) => i.severity === "minor")
      .map((i) => `Review tip (${i.category}): ${i.problem} → ${i.fix}`) ?? [];

  const result: GenerateSuccess = {
    ok: true,
    plan: attempt.plan,
    unverified,
    warnings: [...validation.warnings, ...tips],
    promptVersion: PROMPT_VERSION,
    model,
    latencyMs,
    firstPlanMs: firstPlanMs ?? latencyMs,
    tokens,
    repairCount,
    improved,
    review,
    raw,
  };
  emit?.({ type: "final", result });
  return result;
}
