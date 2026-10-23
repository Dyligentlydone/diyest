import OpenAI from "openai";
import { requireEnv } from "@/lib/env";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  client ??= new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return client;
}

/** Vision-capable chat model for plan/diagnosis generation. */
export function planModel(): string {
  return process.env.AI_MODEL_PLAN || process.env.AI_MODEL || "gpt-4o";
}

/** Strongest available model — used for the buildability review. */
export function reviewModel(): string {
  return process.env.AI_MODEL_REVIEW || planModel();
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
