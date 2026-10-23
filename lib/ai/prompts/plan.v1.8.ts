// lib/ai/prompts/plan.v1.8.ts
// plan.v1.8 — identical data contract to v1.7; adds an orientation convention:
// the piece's front (knee space, drawer pulls, open bays) must face +z and the
// model must preserve the photo's left/right handedness. Blueprint views and
// the 3D preview all assume this axis convention, so drawings match the photo.

export * from "./plan.v1.7";

export const PROMPT_VERSION = "plan.v1.8";
