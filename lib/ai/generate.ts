/**
 * Plan generation orchestrator (plan.v1.3 + review.v1):
 *   generate → Zod parse → geometry validation → repair once if needed
 *   → buildability review (AI_MODEL_REVIEW, gated by REVIEW_MODE)
 *   → blocker/major issues → one more repair → re-validate + re-review once
 *   → surviving issues surface as `unverified`; minors surface as tips.
 * Server-side only — never import from client components.
 */
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  buildPlanUserMessage,
  buildRepairMessage,
  PLAN_SYSTEM_PROMPT,
  PROMPT_VERSION,
  type PlanRequest,
} from "./prompts/plan.v1.3";
import {
  buildReviewUserMessage,
  REVIEW_SYSTEM_PROMPT,
  reviewIssuesForRepair,
  reviewSchema,
  type Review,
} from "./prompts/review.v1";
import { planModel, reviewMode, reviewModel, getOpenAI, supportsTemperature } from "./openai";
import { NOT_BUILDABLE_TITLE, planSchema, type Plan } from "@/lib/plan/schema";
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
  tokens: number;
  /** number of repair passes that ran (geometry + review) */
  repairCount: number;
  review: ReviewInfo | null;
  raw: string;
}

export type GenerateResult =
  | GenerateSuccess
  | { ok: false; kind: "not_buildable"; summary: string; raw: string }
  | { ok: false; kind: "invalid"; errors: string[]; raw: string };

async function callModel(
  messages: ChatCompletionMessageParam[],
  imageDataUrls: string[],
  model = planModel()
): Promise<{ raw: string; latencyMs: number; tokens: number }> {
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

  const completion = await getOpenAI().chat.completions.parse({
    model,
    messages: withImages,
    response_format: zodResponseFormat(planSchema, "plan"),
    ...(supportsTemperature(model) ? { temperature: 0.3 } : {}),
  });

  return {
    raw: completion.choices[0]?.message?.content ?? "",
    latencyMs: Date.now() - start,
    tokens: completion.usage?.total_tokens ?? 0,
  };
}

/** Buildability review — JSON only, no images, on AI_MODEL_REVIEW. */
async function callReview(
  planJson: string,
  req: PlanRequest
): Promise<ReviewInfo> {
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
  if (title === NOT_BUILDABLE_TITLE) return { plan: json as Plan, parseErrors: [] };

  const result = planSchema.safeParse(json);
  if (!result.success) {
    return {
      plan: null,
      parseErrors: result.error.issues
        .slice(0, 20)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { plan: result.data, parseErrors: [] };
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

export async function generatePlan(
  req: PlanRequest,
  imageDataUrls: string[],
  ctx: Parameters<typeof validatePlan>[1] = {}
): Promise<GenerateResult> {
  const model = planModel();
  const userMessage = buildPlanUserMessage({ ...req, imageCount: imageDataUrls.length });
  const genMessages = (extra: ChatCompletionMessageParam[] = []): ChatCompletionMessageParam[] => [
    { role: "system", content: PLAN_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
    ...extra,
  ];

  // ---- attempt 1 ----
  const first = await callModel(genMessages(), imageDataUrls);
  let raw = first.raw;
  let latencyMs = first.latencyMs;
  let tokens = first.tokens;
  let repairCount = 0;

  const nb = isNotBuildable(raw);
  if (nb) return { ok: false, kind: "not_buildable", summary: nb.summary, raw };

  let attempt = tryParse(raw);
  let validation: ValidationResult = { errors: attempt.parseErrors, warnings: [] };
  if (attempt.plan) {
    validation = await validatePlan(attempt.plan, ctx);
    validation.errors = [...attempt.parseErrors, ...validation.errors];
  }

  // ---- geometry repair pass (once) ----
  if (validation.errors.length) {
    repairCount++;
    const second = await callModel(
      genMessages([
        { role: "assistant", content: raw },
        { role: "user", content: buildRepairMessage(raw, validation.errors) },
      ]),
      imageDataUrls
    );
    raw = second.raw;
    latencyMs += second.latencyMs;
    tokens += second.tokens;

    const nb2 = isNotBuildable(raw);
    if (nb2) return { ok: false, kind: "not_buildable", summary: nb2.summary, raw };

    attempt = tryParse(raw);
    validation = attempt.plan
      ? await validatePlan(attempt.plan, ctx)
      : { errors: [], warnings: [] };
    validation.errors = [...attempt.parseErrors, ...validation.errors];
  }

  if (!attempt.plan) {
    return { ok: false, kind: "invalid", errors: validation.errors, raw };
  }

  // ---- buildability review (only when geometry is clean) ----
  let review: ReviewInfo | null = null;
  const mode = reviewMode();
  const shouldReview =
    mode === "all" || (mode === "load_bearing" && attempt.plan.load_bearing);
  if (!validation.errors.length && shouldReview) {
    const reviewIssueLines = (r: ReviewInfo) => reviewIssuesForRepair({ verdict: r.verdict, summary: "", issues: r.issues } as Review);

    review = await callReview(raw, req);
    latencyMs += review.latencyMs;
    tokens += review.tokens;

    if (review.verdict !== "pass") {
      const blockers = reviewIssueLines(review);
      if (blockers.length) {
        // one more repair driven by review issues, then re-validate + re-review
        repairCount++;
        const third = await callModel(
          genMessages([
            { role: "assistant", content: raw },
            { role: "user", content: buildRepairMessage(raw, blockers) },
          ]),
          imageDataUrls
        );
        raw = third.raw;
        latencyMs += third.latencyMs;
        tokens += third.tokens;

        const nb3 = isNotBuildable(raw);
        if (nb3) return { ok: false, kind: "not_buildable", summary: nb3.summary, raw };

        attempt = tryParse(raw);
        validation = attempt.plan
          ? await validatePlan(attempt.plan, ctx)
          : { errors: [...attempt.parseErrors], warnings: [] };
        validation.errors = [...attempt.parseErrors, ...validation.errors];

        if (attempt.plan && !validation.errors.length) {
          const re = await callReview(raw, req);
          latencyMs += re.latencyMs;
          tokens += re.tokens;
          review = re;
        } else {
          review = null; // geometry regressed; unverified carries those errors
        }
      }
    }
  }

  if (!attempt.plan) {
    return { ok: false, kind: "invalid", errors: validation.errors, raw };
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

  // minor review issues surface as tips, not errors
  const tips =
    review?.issues
      .filter((i) => i.severity === "minor")
      .map((i) => `Review tip (${i.category}): ${i.problem} → ${i.fix}`) ?? [];

  return {
    ok: true,
    plan: attempt.plan,
    unverified,
    warnings: [...validation.warnings, ...tips],
    promptVersion: PROMPT_VERSION,
    model,
    latencyMs,
    tokens,
    repairCount,
    review,
    raw,
  };
}
