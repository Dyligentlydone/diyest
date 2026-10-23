import OpenAI from "openai";
import { requireEnv } from "@/lib/env";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  client ??= new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return client;
}

/** Vision-capable chat model for all plan/diagnosis calls. Swap via env. */
export function aiModel(): string {
  return process.env.AI_MODEL || "gpt-4o";
}

/** Some models reject an explicit temperature; only send it where supported. */
export function supportsTemperature(model: string): boolean {
  return /^(gpt-4|gpt-3|o1-mini)/i.test(model);
}
