/**
 * Plan generation orchestrator: prompt → model → JSON → Zod → consistency
 * validation → one repair pass on failure (brief §3, §6).
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
} from "./prompts/plan.v1";
import { aiModel, getOpenAI, supportsTemperature } from "./openai";
import { NOT_BUILDABLE_TITLE, planSchema, type Plan } from "@/lib/plan/schema";
import { validatePlan, type ValidationResult } from "@/lib/plan/validate";

export interface GenerateSuccess {
  ok: true;
  plan: Plan;
  /** consistency issues that survived the repair attempt — show on the plan */
  unverified: string[];
  warnings: string[];
  promptVersion: string;
  model: string;
  latencyMs: number;
  tokens: number;
  repaired: boolean;
  raw: string;
}

export type GenerateResult =
  | GenerateSuccess
  | { ok: false; kind: "not_buildable"; summary: string; raw: string }
  | { ok: false; kind: "invalid"; errors: string[]; raw: string };

async function callModel(
  messages: ChatCompletionMessageParam[],
  imageDataUrls: string[]
): Promise<{ raw: string; latencyMs: number; tokens: number }> {
  const model = aiModel();
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
  const model = aiModel();
  const userMessage = buildPlanUserMessage({ ...req, imageCount: imageDataUrls.length });

  // ---- attempt 1 ----
  const first = await callModel(
    [
      { role: "system", content: PLAN_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    imageDataUrls
  );

  let raw = first.raw;
  let latencyMs = first.latencyMs;
  let tokens = first.tokens;
  let repaired = false;

  const nb = isNotBuildable(raw);
  if (nb) return { ok: false, kind: "not_buildable", summary: nb.summary, raw };

  let attempt = tryParse(raw);
  let validation: ValidationResult = { errors: attempt.parseErrors, warnings: [] };
  if (attempt.plan) {
    validation = await validatePlan(attempt.plan, ctx);
    validation.errors = [...attempt.parseErrors, ...validation.errors];
  }

  // ---- repair pass (once) ----
  if (validation.errors.length) {
    repaired = true;
    const second = await callModel(
      [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
        { role: "assistant", content: raw },
        { role: "user", content: buildRepairMessage(raw, validation.errors) },
      ],
      imageDataUrls
    );
    raw = second.raw;
    latencyMs += second.latencyMs;
    tokens += second.tokens;

    const nb2 = isNotBuildable(raw);
    if (nb2) return { ok: false, kind: "not_buildable", summary: nb2.summary, raw };

    attempt = tryParse(raw);
    const secondValidation: ValidationResult = attempt.plan
      ? await validatePlan(attempt.plan, ctx)
      : { errors: [], warnings: [] };
    validation = {
      errors: [...attempt.parseErrors, ...secondValidation.errors],
      warnings: secondValidation.warnings,
    };
  }

  if (!attempt.plan) {
    return { ok: false, kind: "invalid", errors: validation.errors, raw };
  }

  return {
    ok: true,
    plan: attempt.plan,
    unverified: validation.errors,
    warnings: validation.warnings,
    promptVersion: PROMPT_VERSION,
    model,
    latencyMs,
    tokens,
    repaired,
    raw,
  };
}
