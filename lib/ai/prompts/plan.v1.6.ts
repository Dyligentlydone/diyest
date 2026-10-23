// lib/ai/prompts/plan.v1.6.ts
// plan.v1.6 — identical data contract to v1.5; the stage-1 system prompt
// gains a "Reading the photo" survey pass so multi-wing objects (L/U/T
// desks, corner benches, wraparound counters, sectionals) get every
// component modeled — not just the main run — and hidden structure is
// inferred instead of dropped.

export * from "./plan.v1.5";

export const PROMPT_VERSION = "plan.v1.6";
