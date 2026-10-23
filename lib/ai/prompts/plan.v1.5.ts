// lib/ai/prompts/plan.v1.5.ts
// plan.v1.5 — identical data contract to v1.4; the stage-2 system prompt
// (plan.stages.ts) gains rules against the three most-common review-issue
// categories logged across the routing-plan experiment runs:
//   joint_strength — wood around bores/sockets, pocket-hole face width &
//                    jig capacity, racking resistance beyond brackets alone
//   hardware       — fastener install prep named + stepped (clip grooves,
//                    recesses, slot direction), head/washer/drive matching
//   clarity        — every position measured from a named datum, every part
//                    gets a cut step, no step may reference uninstructed work
// Keep v1.3/v1.4 in the repo so eval results stay comparable by version tag.

export * from "./plan.v1.4";

export const PROMPT_VERSION = "plan.v1.5";
