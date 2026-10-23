/**
 * Plan generation pipeline (docs/MODEL-ROUTING-PLAN.md §3):
 *
 *   STAGE 1 (Luna, streamed) → meta events as title/summary/parts arrive
 *   → geometry validation + code-computed contact list
 *   → EMIT "partial" (blueprint renders while stage 2 runs)
 *   → STAGE 2 (Luna): joints (per listed contact), steps, tools, safety
 *   → finalize (derive hardware, joint→step coverage) → EMIT "plan"
 *   → full validation ∥ Sol buildability review (concurrent)
 *   → ONE merged targeted repair (joints/steps, or parts-only for geometry)
 *   → re-review only if a blocker was fixed
 *   → escalation: re-run stages on Sol if blockers remain (cost-capped)
 *   → EMIT "final" (with `improved`/`escalated`/`blockers`)
 *
 * Every model call is cost-logged (CallRecord) and capped by PLAN_COST_CAP_USD.
 * Server-side only — never import from client components.
 */
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import {
  buildJointRepairMessage,
  buildPlanUserMessage,
  buildRepairMessage,
  jointRepairSchema,
  PROMPT_VERSION,
  type JointRepair,
  type PlanRequest,
} from "./prompts/plan.v1.4";
import {
  buildPartsRepairMessage,
  buildStage2UserMessage,
  partsRepairSchema,
  stage1Schema,
  stage2Schema,
  STAGE1_SYSTEM_PROMPT,
  STAGE2_SYSTEM_PROMPT,
  type PartsRepair,
  type Stage1Plan,
} from "./prompts/plan.stages";
import {
  buildReviewUserMessage,
  REVIEW_SYSTEM_PROMPT,
  reviewIssuesForRepair,
  reviewSchema,
  type Review,
} from "./prompts/review.v1";
import {
  escalationModel,
  getOpenAI,
  planModel,
  reasoningEffort,
  reviewMode,
  reviewModel,
  reviewTier,
  supportsTemperature,
} from "./openai";
import { costUsd, planCostCapUsd, type CallRecord, type TokenUsage } from "./pricing";
import {
  NOT_BUILDABLE_TITLE,
  type GenPlan,
  type Plan,
} from "@/lib/plan/schema";
import { finalizePlan } from "@/lib/plan/derive";
import {
  contactPairs,
  validatePlan,
} from "@/lib/plan/validate";

const CALL_TIMEOUT_MS = 120_000; // review/repair calls
const GEN_TIMEOUT_MS = 240_000; // stage calls legitimately run 90–200s

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
  /** consistency/buildability issues that survived repair — details list */
  unverified: string[];
  /**
   * Blocker-level subset of unverified: remaining validation errors + review
   * "blocker" issues. When non-empty the UI shows the friendly "this one's
   * tricky" state instead of a raw issue list (§3 step 6).
   */
  blockers: string[];
  warnings: string[];
  promptVersion: string;
  model: string;
  latencyMs: number;
  /** ms from call start until the first useful UI content (meta title) */
  firstMetaMs: number | null;
  /** ms from call start until the full plan was on screen */
  firstPlanMs: number;
  tokens: number;
  /** all-in USD cost of every model call this plan made */
  costUsd: number;
  /** per-call breakdown for generation_logs (§8) */
  calls: CallRecord[];
  repairCount: number;
  /** true when a repair pass produced a better plan than the first draft */
  improved: boolean;
  /** set when the plan was regenerated on the escalation model */
  escalated: string | null;
  review: ReviewInfo | null;
  /** true when the intended review model failed and a fallback/pending state applies */
  reviewPending: boolean;
  raw: string;
}

export type GenerateError =
  | { ok: false; kind: "not_buildable"; summary: string; raw: string }
  | { ok: false; kind: "invalid"; errors: string[]; raw: string };

export type GenerateResult = GenerateSuccess | GenerateError;

/** Progressive events for streaming UIs (NDJSON on /api/generate). */
export type GenEvent =
  | {
      type: "meta";
      /** fields as soon as they stream in — title first, then summary, parts count */
      title?: string;
      summary?: string;
      partsReceived?: number;
    }
  | {
      type: "partial";
      /** blueprint-ready draft (geometry done, joints/steps pending) */
      plan: Plan;
    }
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

// ---------------------------------------------------------------------------
// model calls
// ---------------------------------------------------------------------------

interface CallOpts {
  model?: string;
  tier?: string;
  effort?: "low" | "medium" | "high" | null;
  /** stream deltas — onDelta gets the accumulated raw JSON as it arrives */
  stream?: boolean;
  onDelta?: (acc: string) => void;
  /** per-call timeout (default GEN_TIMEOUT_MS for stage calls) */
  timeoutMs?: number;
}

interface CallResult<T> {
  raw: string;
  parsed: T | null;
  usage: TokenUsage;
  latencyMs: number;
}

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

function usageOf(u: {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
} | null | undefined): TokenUsage {
  if (!u) return { ...ZERO_USAGE };
  return {
    inputTokens: u.prompt_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

async function callModel<T>(
  messages: ChatCompletionMessageParam[],
  imageDataUrls: string[],
  schemaName: string,
  schema: z.ZodType<T>,
  opts: CallOpts = {}
): Promise<CallResult<T>> {
  const start = Date.now();
  const model = opts.model ?? planModel();

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

  const effort = opts.effort !== undefined ? opts.effort : reasoningEffort(model);
  const params = {
    model,
    messages: withImages,
    response_format: zodResponseFormat(schema, schemaName),
    ...(supportsTemperature(model) ? { temperature: 0.3 } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(opts.tier ? { service_tier: opts.tier as "flex" | "priority" } : {}),
  };
  const requestOpts = { timeout: opts.timeoutMs ?? GEN_TIMEOUT_MS, maxRetries: 1 };

  if (opts.stream) {
    let raw = "";
    let usage = { ...ZERO_USAGE };
    let lastEmit = 0;
    const stream = await getOpenAI().chat.completions.create(
      { ...params, stream: true, stream_options: { include_usage: true } },
      requestOpts
    );
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        raw += delta;
        const now = Date.now();
        if (opts.onDelta && now - lastEmit > 150) {
          lastEmit = now;
          opts.onDelta(raw);
        }
      }
      if (chunk.usage) usage = usageOf(chunk.usage);
    }
    opts.onDelta?.(raw);
    let parsed: T | null = null;
    try {
      const r = schema.safeParse(JSON.parse(raw));
      parsed = r.success ? r.data : null;
    } catch {
      parsed = null;
    }
    return { raw, parsed, usage, latencyMs: Date.now() - start };
  }

  const completion = await getOpenAI().chat.completions.parse(params, requestOpts);
  return {
    raw: completion.choices[0]?.message?.content ?? "",
    parsed: (completion.choices[0]?.message?.parsed ?? null) as T | null,
    usage: usageOf(completion.usage),
    latencyMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// review (§3 step 4 — Sol always; Luna fallback marks review pending, §8)
// ---------------------------------------------------------------------------

async function callReviewRawUsage(
  planJson: string,
  req: PlanRequest,
  model: string,
  tier?: string
): Promise<{ info: ReviewInfo; usage: TokenUsage }> {
  const start = Date.now();
  const completion = await getOpenAI().chat.completions.parse(
    {
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
      ...(tier ? { service_tier: tier as "flex" | "priority" } : {}),
    },
    { timeout: CALL_TIMEOUT_MS, maxRetries: 1 }
  );
  const parsed = completion.choices[0]?.message?.parsed as Review | null;
  const usage = usageOf(completion.usage);
  return {
    info: {
      verdict: parsed?.verdict ?? "pass",
      summary: parsed?.summary ?? "",
      issues: parsed?.issues ?? [],
      model,
      latencyMs: Date.now() - start,
      tokens: completion.usage?.total_tokens ?? 0,
    },
    usage,
  };
}

/** Exported for the reviewer benchmark (experiment D). */
export async function callReview(
  planJson: string,
  req: PlanRequest,
  model = reviewModel()
): Promise<ReviewInfo> {
  return (await callReviewRawUsage(planJson, req, model, reviewTier())).info;
}

interface ReviewOutcome {
  review: ReviewInfo | null;
  /** true when the configured review model failed and Luna reviewed instead */
  pending: boolean;
  call: CallRecord | null;
}

async function reviewWithFallback(planJson: string, req: PlanRequest): Promise<ReviewOutcome> {
  const model = reviewModel();
  const tier = reviewTier();
  for (const [stage, m, t] of [
    ["review", model, tier] as const,
    ["review_fallback", planModel(), undefined] as const,
  ]) {
    try {
      const r = await callReviewRawUsage(planJson, req, m, t);
      return {
        review: r.info,
        pending: stage === "review_fallback",
        call: {
          stage,
          model: m,
          tier: t ?? "standard",
          usage: r.usage,
          costUsd: costUsd(m, r.usage, t),
          latencyMs: r.info.latencyMs,
        },
      };
    } catch (e) {
      if (stage === "review")
        console.warn(`[review] ${m} failed (${(e as Error).message}) — falling back to ${planModel()}`);
      else console.error(`[review] fallback also failed (${(e as Error).message}) — review pending`);
    }
  }
  return { review: null, pending: true, call: null };
}

// ---------------------------------------------------------------------------
// parsing helpers
// ---------------------------------------------------------------------------

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

function stage1Shell(s1: Stage1Plan, req: PlanRequest): Plan {
  return {
    ...s1,
    joints: [],
    steps: [],
    tools: [],
    safety_overview: [],
    est_hours: 0,
    est_cost: { low: 0, high: 0, currency: req.currency },
    hardware: [],
  } as Plan;
}

/** Remaining validation errors + review "blocker" issues = blocker level. */
function computeBlockers(validationErrors: string[], review: ReviewInfo | null): string[] {
  const out = [...validationErrors];
  for (const i of review?.issues ?? [])
    if (i.severity === "blocker") out.push(`[REVIEW blocker · ${i.category}] ${i.problem}`);
  return out;
}

/** Review issues that are joint/step-scoped → fixable by the targeted repair. */
function jointScoped(i: Review["issues"][number]): boolean {
  return i.joint_id != null || i.step != null;
}

/** Extract the meta fields that arrive first in the streamed stage-1 JSON. */
function metaFromPartialJson(acc: string): Extract<GenEvent, { type: "meta" }> | null {
  const ev: Extract<GenEvent, { type: "meta" }> = { type: "meta" };
  const t = acc.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const s = acc.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  try {
    if (t) ev.title = JSON.parse(`"${t[1]}"`) as string;
    if (s) ev.summary = JSON.parse(`"${s[1]}"`) as string;
  } catch {
    /* partial JSON — skip */
  }
  const parts = (acc.match(/"placements"\s*:/g) ?? []).length;
  if (parts) ev.partsReceived = parts;
  return ev.title || ev.summary || ev.partsReceived ? ev : null;
}

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------

export interface GenerateOpts {
  model?: string;
  /** stream stage 1 → "meta" events as fields arrive (default true) */
  stream?: boolean;
}

export async function generatePlan(
  req: PlanRequest,
  imageDataUrls: string[],
  ctx: Parameters<typeof validatePlan>[1] = {},
  emit?: (ev: GenEvent) => void,
  opts: GenerateOpts = {}
): Promise<GenerateResult> {
  const t0 = Date.now();
  const model = opts.model ?? planModel();
  const calls: CallRecord[] = [];
  let firstMetaAt: number | null = null;
  const costSoFar = () => calls.reduce((s, c) => s + c.costUsd, 0);
  const track = <T>(stage: string, m: string, tier: string | undefined, r: CallResult<T>) => {
    calls.push({
      stage,
      model: m,
      tier: tier ?? "standard",
      usage: r.usage,
      costUsd: costUsd(m, r.usage, tier),
      latencyMs: r.latencyMs,
    });
  };
  const fail = (r: GenerateError): GenerateResult => {
    emit?.({ type: "error", result: r });
    return r;
  };

  const userMessage = buildPlanUserMessage({ ...req, imageCount: imageDataUrls.length });
  const s1Env = process.env.AI_REASONING_EFFORT_S1;
  const s1Effort =
    s1Env === "low" || s1Env === "high" || s1Env === "medium"
      ? s1Env
      : reasoningEffort(model);

  /**
   * Stage 1 + geometry check + stage 2 for a given model.
   * Streamed (meta + partial events) only for the primary run.
   */
  const cap = planCostCapUsd();
  const runStages = async (
    m: string,
    opts2: { streamed: boolean; escalate: boolean }
  ): Promise<{ s1: Stage1Plan; plan: Plan } | GenerateError> => {
    const streamed = opts2.streamed;
    const tag = opts2.escalate ? "escalate" : "stage";
    const overBudget = () => !streamed && costSoFar() >= cap;
    const onDelta =
      emit && streamed
        ? (acc: string) => {
            const ev = metaFromPartialJson(acc);
            if (ev) {
              if (firstMetaAt == null) firstMetaAt = Date.now() - t0;
              emit(ev);
            }
          }
        : undefined;

    // ---- stage 1: overview + parts ----
    const s1res = await callModel<Stage1Plan>(
      [
        { role: "system", content: STAGE1_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      imageDataUrls,
      "plan_stage1",
      stage1Schema,
      { model: m, stream: streamed, onDelta, effort: s1Effort }
    );
    track(`${tag}1`, m, undefined, s1res);

    const nb = isNotBuildable(s1res.raw);
    if (nb) return { ok: false, kind: "not_buildable", summary: nb.summary, raw: s1res.raw };
    let s1 = s1res.parsed;
    if (!s1) {
      // one retry with the failure spelled out
      const retry = await callModel<Stage1Plan>(
        [
          { role: "system", content: STAGE1_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
          { role: "assistant", content: s1res.raw },
          {
            role: "user",
            content: "That response did not match the schema. Return the same stage-1 plan as valid JSON matching the schema exactly.",
          },
        ],
        imageDataUrls,
        "plan_stage1",
        stage1Schema,
        { model: m, effort: s1Effort }
      );
      track(`${tag}1_retry`, m, undefined, retry);
      s1 = retry.parsed;
      if (!s1)
        return {
          ok: false,
          kind: "invalid",
          errors: ["Stage 1 output was unusable"],
          raw: retry.raw || s1res.raw,
        };
    }

    // ---- geometry validation + one targeted parts repair ----
    let partial = stage1Shell(s1, req);
    const geo = await validatePlan(partial, ctx, { stage: "geometry" });
    if (geo.errors.length) {
      const rep = await callModel<PartsRepair>(
        [
          { role: "system", content: STAGE1_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
          { role: "assistant", content: s1res.raw },
          { role: "user", content: buildPartsRepairMessage(s1res.raw, geo.errors) },
        ],
        imageDataUrls,
        "parts_repair",
        partsRepairSchema,
        { model: m, effort: s1Effort }
      );
      track(`${tag}1_geomrepair`, m, undefined, rep);
      if (rep.parsed?.parts?.length) {
        s1 = {
          ...s1,
          parts: rep.parsed.parts,
          overall_dimensions_mm: rep.parsed.overall_dimensions_mm ?? s1.overall_dimensions_mm,
        };
        partial = stage1Shell(s1, req);
        // re-validate once (§3 step 2, max 1 repair) — remaining errors are
        // still caught by the full validation after stage 2
        await validatePlan(partial, ctx, { stage: "geometry" });
      }
    }

    // ---- contact list in code (§3 step 2) ----
    const contacts = contactPairs(partial);
    emit?.({ type: "partial", plan: partial });
    if (overBudget())
      return { ok: false, kind: "invalid", errors: ["over budget"], raw: "" };

    // ---- stage 2: joints, steps, tools, safety, estimates ----
    const s2res = await callModel(
      [
        { role: "system", content: STAGE2_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildStage2UserMessage(s1, contacts, req),
        },
      ],
      [], // no images — geometry is fixed, stage 2 is text-only
      "plan_stage2",
      stage2Schema,
      { model: m }
    );
    track(`${tag}2`, m, undefined, s2res);
    if (!s2res.parsed)
      return {
        ok: false,
        kind: "invalid",
        errors: ["Stage 2 output was unusable"],
        raw: s2res.raw,
      };

    const merged = { ...s1, ...s2res.parsed } as GenPlan;
    return { s1, plan: finalizePlan(merged) };
  };

  // ================= primary run =================
  const primary = await runStages(model, { streamed: opts.stream !== false, escalate: false });
  if (!("plan" in primary)) return fail(primary);

  const plan = primary.plan;
  const firstPlanMs = Date.now() - t0;
  emit?.({
    type: "plan",
    plan,
    unverified: [],
    warnings: [],
    promptVersion: PROMPT_VERSION,
    firstPlanMs,
  });

  // ---- full validation ∥ buildability review (§3 step 4) ----
  const mode = reviewMode();
  const shouldReview = mode === "all" || (mode === "load_bearing" && plan.load_bearing);
  const [validation, reviewOut] = await Promise.all([
    validatePlan(plan, ctx),
    shouldReview ? reviewWithFallback(JSON.stringify(plan), req) : Promise.resolve({ review: null, pending: false, call: null } as ReviewOutcome),
  ]);
  if (reviewOut.call) calls.push(reviewOut.call);
  let review = reviewOut.review;
  let reviewPending = reviewOut.pending;

  let repairCount = 0;
  let improved = false;
  let escalated: string | null = null;
  let currentPlan = plan;

  // ---- ONE merged targeted repair (§3 step 5) ----
  const reviewLines = review
    ? reviewIssuesForRepair({ verdict: review.verdict, summary: "", issues: review.issues } as Review)
    : [];
  const mergedIssues = [...validation.errors, ...reviewLines];
  const hadBlocker = review?.issues.some((i) => i.severity === "blocker") ?? false;

  if (mergedIssues.length) {
    repairCount++;
    const geometryDirty = validation.issues.some((i) => i.kind === "geometry");
    const listsDirty = validation.issues.some((i) => i.kind === "lists");
    const nonMinorReview = (review?.issues ?? []).filter((i) => i.severity !== "minor");
    const reviewJointScoped =
      review == null || nonMinorReview.every(jointScoped);

    if (!geometryDirty && reviewJointScoped) {
      // list-class only → targeted joints/steps repair
      const rep = await callModel<JointRepair>(
        [
          { role: "system", content: STAGE2_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(currentPlan) },
          { role: "user", content: buildJointRepairMessage(JSON.stringify(currentPlan), mergedIssues) },
        ],
        [],
        "joint_repair",
        jointRepairSchema,
        { model }
      );
      track("repair_joints", model, undefined, rep);
      if (rep.parsed?.joints && rep.parsed?.steps) {
        currentPlan = finalizePlan({
          ...currentPlan,
          consumables: currentPlan.consumables ?? [],
          joints: rep.parsed.joints,
          steps: rep.parsed.steps,
        } as GenPlan);
      }
    } else if (geometryDirty && !listsDirty && !nonMinorReview.length) {
      // geometry only → parts-only repair
      const rep = await callModel<PartsRepair>(
        [
          { role: "system", content: STAGE1_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
          { role: "user", content: buildPartsRepairMessage(JSON.stringify(currentPlan), mergedIssues) },
        ],
        imageDataUrls,
        "parts_repair",
        partsRepairSchema,
        { model, effort: s1Effort }
      );
      track("repair_parts", model, undefined, rep);
      if (rep.parsed?.parts?.length) {
        currentPlan = finalizePlan({
          ...currentPlan,
          parts: rep.parsed.parts,
          overall_dimensions_mm:
            rep.parsed.overall_dimensions_mm ?? currentPlan.overall_dimensions_mm,
        } as GenPlan);
      }
    } else {
      // mixed issues → one full-plan repair
      const rep = await callModel<GenPlan>(
        [
          { role: "system", content: STAGE2_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(currentPlan) },
          { role: "user", content: buildRepairMessage(JSON.stringify(currentPlan), mergedIssues) },
        ],
        imageDataUrls,
        "plan",
        stage1FullSchema,
        { model }
      );
      track("repair_full", model, undefined, rep);
      if (rep.parsed) currentPlan = finalizePlan(rep.parsed);
    }

    // re-validate
    const v2 = await validatePlan(currentPlan, ctx);
    improved = !v2.errors.length || mergedIssues.length > v2.errors.length;
    validation.errors = v2.errors;
    validation.issues = v2.issues;
    validation.warnings = v2.warnings;

    // re-review only if a blocker was being fixed (§3 step 5)
    if (hadBlocker && !v2.errors.length && shouldReview) {
      const re = await reviewWithFallback(JSON.stringify(currentPlan), req);
      if (re.call) calls.push(re.call);
      review = re.review ?? review;
      reviewPending = reviewPending || re.pending;
    }
  }

  let blockers = computeBlockers(validation.errors, review);

  // ---- escalation (§3 step 6): stages 1+2 on the strong model, cost-capped ----
  const escModel = escalationModel();
  if (blockers.length && escModel && costSoFar() < cap) {
    const esc = await runStages(escModel, { streamed: false, escalate: true });
    if ("plan" in esc) {
      if (costSoFar() < cap) {
        const [ev, er] = await Promise.all([
          validatePlan(esc.plan, ctx),
          shouldReview ? reviewWithFallback(JSON.stringify(esc.plan), req) : Promise.resolve({ review: null, pending: false, call: null } as ReviewOutcome),
        ]);
        if (er.call) calls.push(er.call);
        const eBlockers = computeBlockers(ev.errors, er.review);
        if (eBlockers.length < blockers.length) {
          escalated = escModel;
          currentPlan = esc.plan;
          validation.errors = ev.errors;
          validation.issues = ev.issues;
          validation.warnings = ev.warnings;
          review = er.review;
          reviewPending = er.pending;
          blockers = eBlockers;
          improved = true;
          emit?.({
            type: "plan",
            plan: currentPlan,
            unverified: ev.errors,
            warnings: ev.warnings,
            promptVersion: PROMPT_VERSION,
            firstPlanMs: Date.now() - t0,
          });
        }
      } else {
        console.warn(`[generate] cost cap $${cap} reached mid-escalation — keeping original plan`);
      }
    }
  } else if (blockers.length && costSoFar() >= cap) {
    console.warn(`[generate] cost cap $${cap} reached — skipping escalation`);
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

  const tokens = calls.reduce((s, c) => s + c.usage.inputTokens + c.usage.outputTokens, 0);
  const latencyMs = Date.now() - t0;

  const result: GenerateSuccess = {
    ok: true,
    plan: currentPlan,
    unverified,
    blockers,
    warnings: [...validation.warnings, ...tips],
    promptVersion: PROMPT_VERSION,
    model: escalated ?? model,
    latencyMs,
    firstMetaMs: firstMetaAt,
    firstPlanMs,
    tokens,
    costUsd: costSoFar(),
    calls,
    repairCount,
    improved,
    escalated,
    review,
    reviewPending,
    raw: JSON.stringify(currentPlan),
  };
  emit?.({ type: "final", result });
  return result;
}

// full-plan schema for the mixed-issue repair (gen output shape)
const stage1FullSchema = stage1Schema.extend({
  joints: stage2Schema.shape.joints,
  steps: stage2Schema.shape.steps,
  tools: stage2Schema.shape.tools,
  safety_overview: stage2Schema.shape.safety_overview,
  est_hours: stage2Schema.shape.est_hours,
  est_cost: stage2Schema.shape.est_cost,
});

// (end of file)
