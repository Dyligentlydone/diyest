import OpenAI from "openai";
import { requireEnv } from "@/lib/env";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  client ??= new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return client;
}

/** Vision-capable chat model for stage-1 geometry/photo generation. */
export function planModel(): string {
  return process.env.AI_MODEL_PLAN || process.env.AI_MODEL || "gpt-4o";
}

/**
 * Text-only model for stage 2 (joints, steps, tools, safety) once stage-1
 * geometry is locked. Defaults to AI_MODEL_STAGE2 → AI_MODEL → planModel() so
 * stage 1 can use a reasoning vision model (gpt-5) while stage 2 runs fast
 * and cheap on gpt-4.1 / gpt-5-mini.
 */
export function stage2Model(): string {
  return process.env.AI_MODEL_STAGE2 || process.env.AI_MODEL || planModel();
}

/** Strongest available model — used for the buildability review. */
export function reviewModel(): string {
  return process.env.AI_MODEL_REVIEW || planModel();
}

/**
 * Escalation model (model routing plan §3 step 6): when a plan still has
 * blocker-level issues after the repair pass, stages 1+2 are re-run on this
 * (stronger) model — subject to the per-plan cost cap. Empty/unset or equal
 * to AI_MODEL_PLAN = no escalation.
 */
export function escalationModel(): string | null {
  const v = process.env.AI_MODEL_ESCALATE;
  return v && v !== planModel() ? v : null;
}

/** Chat ("I'm stuck") and ideas models — wired when those routes land. */
export function chatModel(): string {
  return process.env.AI_MODEL_CHAT || planModel();
}
export function ideasModel(): string {
  return process.env.AI_MODEL_IDEAS || planModel();
}
/** Safety-critical diagnosis (electrical/gas/structural) — strongest model. */
export function diagnoseModel(): string {
  return process.env.AI_MODEL_DIAGNOSE || reviewModel();
}

/** Service tier for the review call — "flex" is ~half price but slower. */
export function reviewTier(): string | undefined {
  const v = process.env.AI_REVIEW_TIER;
  return v === "flex" || v === "priority" ? v : undefined;
}

/**
 * Service tier for generation calls on AI_MODEL_PLAN — stages, geometry and
 * list repairs (BRIEF-v2: Luna stages + Luna repairs run on the Fast tier).
 * "priority" = OpenAI's fast lane. Sol escalation stages also use it so the
 * slower strong model still returns inside the escalation timeout; Sol
 * review/repair calls stay Standard.
 */
export function genTier(): string | undefined {
  const v = process.env.AI_PLAN_TIER ?? "priority";
  return v === "flex" || v === "priority" ? v : undefined;
}

export type ReviewMode = "all" | "load_bearing" | "off";
export function reviewMode(): ReviewMode {
  const v = process.env.REVIEW_MODE;
  return v === "load_bearing" || v === "off" ? v : "all";
}

/** Some models reject an explicit temperature; only send it where supported. */
export function supportsTemperature(model: string): boolean {
  return /^(gpt-4|gpt-3|o1-mini)/i.test(model);
}

/** Reasoning effort for gpt-5/6/o-series models. Default medium (speed). */
export function reasoningEffort(
  model: string
): "low" | "medium" | "high" | null {
  const v = process.env.AI_REASONING_EFFORT || "medium";
  if (!/^(gpt-5|gpt-6|o\d)/i.test(model)) return null;
  return v === "low" || v === "high" ? v : "medium";
}
