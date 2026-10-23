// lib/ai/prompts/plan.v1.7.ts
// plan.v1.7 — identical data contract to v1.6; dimension rules change: when a
// photo is attached, the photographed footprint beats the target numbers.
// Target dimensions scale the piece but may never change its silhouette or
// delete masses — a target depth that can't contain an L-desk's return applies
// to the main run only, with the mismatch surfaced in assumptions and
// clarifying_questions instead of amputating the return.

export * from "./plan.v1.6";

export const PROMPT_VERSION = "plan.v1.7";
