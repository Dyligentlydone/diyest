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
  buildModifyMessage,
  buildPlanUserMessage,
  buildRepairMessage,
  jointRepairSchema,
  PROMPT_VERSION,
  type JointRepair,
  type PlanRequest,
} from "./prompts/plan.v1.8";
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
  type ReviewIssue,
} from "./prompts/review.v1";
import {
  escalationModel,
  genTier,
  getOpenAI,
  planModel,
  reasoningEffort,
  reviewMode,
  reviewModel,
  reviewTier,
  supportsTemperature,
} from "./openai";
import { costUsd, planCostCapUsd, type CallRecord, type TokenUsage } from "./pricing";
import { usageOf } from "./usage-of";
import {
  genPlanSchema,
  NOT_BUILDABLE_TITLE,
  type GenPlan,
  type Plan,
} from "@/lib/plan/schema";
import { finalizePlan } from "@/lib/plan/derive";
import {
  contactPairs,
  validatePlan,
  type ValidationContext,
} from "@/lib/plan/validate";
import { bounds, solidsOf } from "@/lib/blueprint/solids";
import { mirrorPlanAxis } from "@/lib/plan/mirror";

const CALL_TIMEOUT_MS = 120_000; // review/repair calls
const GEN_TIMEOUT_MS = 240_000; // stage calls legitimately run 90–200s
const ESC_TIMEOUT_MS = 360_000; // Sol escalation stages get their own, longer budget

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

export interface CallOpts {
  model?: string;
  tier?: string;
  effort?: "low" | "medium" | "high" | null;
  /** stream deltas — onDelta gets the accumulated raw JSON as it arrives */
  stream?: boolean;
  onDelta?: (acc: string) => void;
  /** per-call timeout (default GEN_TIMEOUT_MS for stage calls) */
  timeoutMs?: number;
}

export interface CallResult<T> {
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

export async function callModel<T>(
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

  // effort only applies to reasoning models — an env-set effort must not be
  // sent to gpt-4.x or the API 400s on the unknown param
  const effort =
    reasoningEffort(model) === null
      ? null
      : opts.effort !== undefined
        ? opts.effort
        : reasoningEffort(model);
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
  tier?: string,
  imageDataUrls: string[] = []
): Promise<{ info: ReviewInfo; usage: TokenUsage }> {
  const start = Date.now();
  const reviewText = buildReviewUserMessage(planJson, {
    skillLevel: req.skillLevel,
    toolsOwned: req.toolsOwned,
    useMyToolsOnly: req.useMyToolsOnly,
    units: req.units,
  });
  const completion = await getOpenAI().chat.completions.parse(
    {
      model,
      messages: [
        { role: "system", content: REVIEW_SYSTEM_PROMPT },
        {
          role: "user",
          // photos attached when available → step 0 photo-fidelity check applies
          content: imageDataUrls.length
            ? [
                { type: "text" as const, text: reviewText },
                ...imageDataUrls.map((url) => ({
                  type: "image_url" as const,
                  image_url: { url, detail: "high" as const },
                })),
              ]
            : reviewText,
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
  model = reviewModel(),
  imageDataUrls: string[] = []
): Promise<ReviewInfo> {
  return (await callReviewRawUsage(planJson, req, model, reviewTier(), imageDataUrls)).info;
}

interface ReviewOutcome {
  review: ReviewInfo | null;
  /** true when the Sol (designated) review didn't run — never claim checked */
  pending: boolean;
  calls: CallRecord[];
}

const SEV_RANK = { blocker: 3, major: 2, minor: 1 } as const;
const VERDICT_RANK = { unsafe: 3, fix: 2, pass: 1 } as const;

/**
 * Merge two reviewers' issue lists: dedupe by (step, joint, category), keep
 * the higher severity, prefer the first reviewer's wording on ties.
 */
function mergeReviewIssues(primary: ReviewIssue[], secondary: ReviewIssue[]): ReviewIssue[] {
  const byKey = new Map<string, ReviewIssue>();
  for (const i of [...primary, ...secondary]) {
    const key = `${i.step ?? "-"}|${i.joint_id ?? "-"}|${i.category}`;
    const prev = byKey.get(key);
    if (!prev || SEV_RANK[i.severity] > SEV_RANK[prev.severity]) byKey.set(key, i);
  }
  return [...byKey.values()].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}

/**
 * §3 step 4 + ship decision: Luna and Sol review in PARALLEL on every plan;
 * issues merged (dedupe by step/joint/category, higher severity wins).
 * Sol failing → Luna's review still stands but the plan is "review pending"
 * (no-silent-downgrade). Luna failing → Sol's review stands alone.
 */
async function reviewBoth(
  planJson: string,
  req: PlanRequest,
  imageDataUrls: string[] = []
): Promise<ReviewOutcome> {
  const sol = reviewModel();
  const luna = planModel();
  const solTier = reviewTier();
  const [solRes, lunaRes] = await Promise.allSettled([
    callReviewRawUsage(planJson, req, sol, solTier, imageDataUrls),
    callReviewRawUsage(planJson, req, luna, undefined, imageDataUrls),
  ]);

  const calls: CallRecord[] = [];
  let solInfo: ReviewInfo | null = null;
  let lunaInfo: ReviewInfo | null = null;
  if (solRes.status === "fulfilled") {
    solInfo = solRes.value.info;
    calls.push({
      stage: "review",
      model: sol,
      tier: solTier ?? "standard",
      usage: solRes.value.usage,
      costUsd: costUsd(sol, solRes.value.usage, solTier),
      latencyMs: solInfo.latencyMs,
    });
  } else {
    console.warn(`[review] ${sol} failed (${(solRes.reason as Error).message}) — Luna review only, marking pending`);
  }
  if (lunaRes.status === "fulfilled") {
    lunaInfo = lunaRes.value.info;
    calls.push({
      stage: "review_luna",
      model: luna,
      tier: "standard",
      usage: lunaRes.value.usage,
      costUsd: costUsd(luna, lunaRes.value.usage),
      latencyMs: lunaInfo.latencyMs,
    });
  } else {
    console.warn(`[review] ${luna} (parallel reviewer) failed (${(lunaRes.reason as Error).message})`);
  }

  if (!solInfo && !lunaInfo) return { review: null, pending: true, calls };
  const base = solInfo ?? lunaInfo!;
  const verdicts = [solInfo?.verdict, lunaInfo?.verdict].filter(
    (v): v is Review["verdict"] => v != null
  );
  const review: ReviewInfo = {
    verdict: verdicts.sort((a, b) => VERDICT_RANK[b] - VERDICT_RANK[a])[0],
    summary: base.summary,
    issues: mergeReviewIssues(solInfo?.issues ?? [], lunaInfo?.issues ?? []),
    model: solInfo && lunaInfo ? `${sol}+${luna}` : base.model,
    latencyMs: Math.max(solInfo?.latencyMs ?? 0, lunaInfo?.latencyMs ?? 0),
    tokens: (solInfo?.tokens ?? 0) + (lunaInfo?.tokens ?? 0),
  };
  return { review, pending: !solInfo, calls };
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

/** Does the plan's real geometry fit inside the given overall dims (x=w, y=h, z=d)? */
function fitsWithinDims(
  plan: Plan,
  dims: Plan["overall_dimensions_mm"]
): boolean {
  const eps = 1.5; // mm slack for rounding
  const { hi } = bounds(solidsOf(plan));
  return (
    hi[0] <= dims.width + eps &&
    hi[1] <= dims.height + eps &&
    hi[2] <= dims.depth + eps
  );
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
  ctx = { ...ctx, hasPhotos: imageDataUrls.length > 0 };
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
    // Luna stages AND Sol escalation run on the Fast (priority) tier.
    const callTier = m === planModel() || opts2.escalate ? genTier() : undefined;
    const callTimeout = opts2.escalate ? ESC_TIMEOUT_MS : undefined;
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
      {
        model: m,
        stream: streamed,
        onDelta,
        effort: s1Effort,
        tier: callTier,
        timeoutMs: callTimeout,
      }
    );
    track(`${tag}1`, m, callTier, s1res);

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
        { model: m, effort: s1Effort, tier: callTier, timeoutMs: callTimeout }
      );
      track(`${tag}1_retry`, m, callTier, retry);
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
        { model: m, effort: s1Effort, tier: callTier, timeoutMs: callTimeout }
      );
      track(`${tag}1_geomrepair`, m, callTier, rep);
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
      { model: m, tier: callTier, timeoutMs: callTimeout }
    );
    track(`${tag}2`, m, callTier, s2res);
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
    shouldReview
      ? reviewBoth(JSON.stringify(plan), req, imageDataUrls)
      : Promise.resolve({ review: null, pending: false, calls: [] } as ReviewOutcome),
  ]);
  calls.push(...reviewOut.calls);
  let review = reviewOut.review;
  let reviewPending = reviewOut.pending;

  let repairCount = 0;
  let improved = false;
  let escalated: string | null = null;
  let currentPlan = plan;

  // ---- deterministic mirror fix: the review sees the photo; if every mass is
  // present but left/right (or front/back) is swapped, flip the geometry in
  // code. No model call can fix handedness reliably — this can.
  const mirroredIssue = review?.issues.find(
    (i) => i.category === "photo_fidelity" && /^MIRRORED(-[XZ])?/i.test(i.problem)
  );
  if (mirroredIssue && imageDataUrls.length) {
    const axis = /MIRRORED-Z/i.test(mirroredIssue.problem) ? ("z" as const) : ("x" as const);
    const flipped = mirrorPlanAxis(currentPlan, axis);
    const mv = await validatePlan(flipped, ctx);
    if (mv.errors.length <= validation.errors.length) {
      currentPlan = flipped;
      validation.errors = mv.errors;
      validation.issues = mv.issues;
      validation.warnings = mv.warnings;
      improved = true;
      // the flip resolved this issue — drop it so it can't trigger
      // a pointless repair or escalation
      review = {
        ...review!,
        issues: review!.issues.filter((i) => i !== mirroredIssue),
      };
      emit?.({
        type: "plan",
        plan: currentPlan,
        unverified: mv.errors,
        warnings: mv.warnings,
        promptVersion: PROMPT_VERSION,
        firstPlanMs: Date.now() - t0,
      });
    }
  }

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
        { model, tier: genTier() }
      );
      track("repair_joints", model, genTier(), rep);
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
        { model, effort: s1Effort, tier: genTier() }
      );
      track("repair_parts", model, genTier(), rep);
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
        { model, tier: genTier() }
      );
      track("repair_full", model, genTier(), rep);
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
      const re = await reviewBoth(JSON.stringify(currentPlan), req, imageDataUrls);
      calls.push(...re.calls);
      review = re.review ?? review;
      reviewPending = reviewPending || re.pending;
    }
  }

  let blockers = computeBlockers(validation.errors, review);

  // ---- escalation (§3 step 6): stages 1+2 on the strong model, cost-capped ----
  // Escalation must never kill a run: any error/timeout keeps the best plan
  // so far (primary + repairs) and reports its blockers as the tricky state.
  const escModel = escalationModel();
  if (blockers.length && escModel && costSoFar() < cap) {
    let esc: Awaited<ReturnType<typeof runStages>> | null = null;
    try {
      esc = await runStages(escModel, { streamed: false, escalate: true });
    } catch (e) {
      console.warn(
        `[generate] escalation on ${escModel} failed (${(e as Error).message}) — keeping pre-escalation plan`
      );
    }
    if (esc && "plan" in esc) {
      if (costSoFar() < cap) {
        // code validation only — no second review pass. The strong model was
        // called BECAUSE the review found blockers; re-reviewing its output
        // added ~90s per run for little signal. Geometry/contact validation
        // is the deterministic gate; adopt when it's at least as clean.
        const ev = await validatePlan(esc.plan, ctx);
        const eBlockers = computeBlockers(ev.errors, null);
        if (eBlockers.length < blockers.length) {
          escalated = escModel;
          // keep the primary plan's stated dimensions unless they were wrong —
          // i.e. the escalated geometry genuinely can't fit inside them
          currentPlan = fitsWithinDims(esc.plan, plan.overall_dimensions_mm)
            ? { ...esc.plan, overall_dimensions_mm: plan.overall_dimensions_mm }
            : esc.plan;
          validation.errors = ev.errors;
          validation.issues = ev.issues;
          validation.warnings = ev.warnings;
          // the adopted plan hasn't itself been carpenter-reviewed — drop the
          // pre-escalation review (its issues refer to the old plan) and never
          // claim "carpenter checked" for this output
          review = null;
          reviewPending = shouldReview;
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
    } else if (esc) {
      console.warn(
        `[generate] escalation on ${escModel} returned ${esc.kind} — keeping pre-escalation plan`
      );
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

// ---------------------------------------------------------------------------
// modify (M4 — "Fit my space" / cheaper / upgrade / restyle / free-text)
// ---------------------------------------------------------------------------

export interface ModifyResult {
  ok: boolean;
  plan?: Plan;
  unverified: string[];
  blockers: string[];
  warnings: string[];
  reviewPending: boolean;
  error?: string;
  calls: CallRecord[];
  /** step numbers the repair changed after the modification */
  changedSteps: number[];
}

/**
 * Apply a user-requested change to an existing plan, then run the same
 * validate → dual review → merged repair path as generation (brief §6.2:
 * "Runs the full validate → review → repair path"). No escalation — a failed
 * modification reports blockers instead of burning more credits.
 */
export async function modifyPlan(
  plan: Plan,
  instruction: string,
  req: PlanRequest,
  ctx: ValidationContext
): Promise<ModifyResult> {
  const calls: CallRecord[] = [];
  const model = planModel();
  const tier = genTier();
  const track = (stage: string, res: CallResult<unknown>) =>
    calls.push({
      stage,
      model,
      tier: tier ?? "standard",
      usage: res.usage,
      costUsd: costUsd(model, res.usage, tier),
      latencyMs: res.latencyMs,
    });

  const gen = await callModel<GenPlan>(
    [
      { role: "system", content: STAGE2_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildModifyMessage(JSON.stringify(plan), instruction),
      },
    ],
    [],
    "plan",
    genPlanSchema,
    { model, tier }
  );
  track("modify", gen);
  if (!gen.parsed)
    return {
      ok: false,
      unverified: [],
      blockers: [],
      warnings: [],
      reviewPending: false,
      error: "The modification couldn't be applied — try rephrasing it.",
      calls,
      changedSteps: [],
    };

  let current = finalizePlan(gen.parsed);

  // ---- validate ∥ dual review ----
  const mode = reviewMode();
  const shouldReview = mode === "all" || (mode === "load_bearing" && current.load_bearing);
  const [validation, reviewOut] = await Promise.all([
    validatePlan(current, ctx),
    shouldReview
      ? reviewBoth(JSON.stringify(current), req)
      : Promise.resolve({ review: null, pending: false, calls: [] } as ReviewOutcome),
  ]);
  calls.push(...reviewOut.calls);
  const review = reviewOut.review;

  // ---- one merged repair on the modified plan ----
  const reviewLines = review
    ? reviewIssuesForRepair({ verdict: review.verdict, summary: "", issues: review.issues } as Review)
    : [];
  const mergedIssues = [...validation.errors, ...reviewLines];
  if (mergedIssues.length) {
    const rep = await callModel<GenPlan>(
      [
        { role: "system", content: STAGE2_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(current) },
        { role: "user", content: buildRepairMessage(JSON.stringify(current), mergedIssues) },
      ],
      [],
      "plan",
      genPlanSchema,
      { model, tier }
    );
    track("modify_repair", rep);
    if (rep.parsed) current = finalizePlan(rep.parsed);
    const v2 = await validatePlan(current, ctx);
    validation.errors = v2.errors;
    validation.warnings = v2.warnings;
  }

  const blockers = computeBlockers(validation.errors, review);
  const tips =
    review?.issues
      .filter((i) => i.severity === "minor")
      .map((i) => `Review tip (${i.category}): ${i.problem} → ${i.fix}`) ?? [];

  // which steps differ from the pre-modify plan (title or text changed)
  const byN = new Map(plan.steps.map((s) => [s.n, s]));
  const changedSteps = current.steps
    .filter((s) => {
      const b = byN.get(s.n);
      return !b || b.title !== s.title || b.text !== s.text;
    })
    .map((s) => s.n);

  return {
    ok: true,
    plan: current,
    unverified: validation.errors,
    blockers,
    warnings: [...validation.warnings, ...tips],
    reviewPending: reviewOut.pending,
    calls,
    changedSteps,
  };
}

// (end of file)
