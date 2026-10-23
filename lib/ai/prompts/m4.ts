// lib/ai/prompts/m4.ts
// Milestone 4 prompts: project ideas (My space / Leftovers), fix-it diagnosis,
// and the "I'm stuck" build chat. Separate from plan.v1.5 so plan prompts stay
// comparable across eval runs.
import { z } from "zod";

export const IDEAS_PROMPT_VERSION = "ideas.v1";
export const DIAGNOSE_PROMPT_VERSION = "diagnose.v1";
export const CHAT_PROMPT_VERSION = "chat.v1";

// ---------------------------------------------------------------------------
// IDEAS — "My space" and "Leftovers" entry modes (Luna)
// ---------------------------------------------------------------------------

export const ideaSchema = z.object({
  title: z.string().min(1),
  summary: z.string(), // 1–2 sentences, plain language
  why_it_fits: z.string(), // why this suits the space / materials
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  est_cost: z.object({ low: z.number(), high: z.number() }),
});

export const ideasSchema = z.object({
  ideas: z.array(ideaSchema).min(2).max(5),
});
export type Ideas = z.infer<typeof ideasSchema>;

export const IDEAS_SYSTEM_PROMPT = `
You are a master carpenter helping a DIYer pick their next project. Given photos and constraints, suggest 3-5 small workshop-scale projects that genuinely fit — realistic sizes, beginner-friendly first. Return ONLY JSON matching the schema. Every idea must be buildable with common home-center materials; note when the user's own materials cover most of it.
`.trim();

export function buildIdeasMessage(req: {
  mode: "space" | "leftovers";
  description?: string;
  spaceMm?: { width?: number; depth?: number; height?: number };
  materialsOwned?: string[];
  skillLevel: string;
  units: string;
}): string {
  const lines: string[] = [];
  if (req.mode === "space") {
    lines.push(
      "The user photographed a space (corner, wall, nook) and wants project ideas that FIT IN IT."
    );
    if (req.spaceMm) {
      const d = req.spaceMm;
      lines.push(
        `SPACE AVAILABLE (mm): ${[
          d.width != null ? `width ${d.width}` : null,
          d.depth != null ? `depth ${d.depth}` : null,
          d.height != null ? `height ${d.height}` : null,
        ]
          .filter(Boolean)
          .join(", ") || "not measured"}`
      );
    }
    lines.push(
      "Suggest ideas sized to fit inside that space with at least 10 mm clearance per side. Mention the fit in why_it_fits."
    );
  } else {
    lines.push(
      "The user has leftover materials and wants project ideas that USE THEM UP."
    );
    if (req.materialsOwned?.length)
      lines.push(`MATERIALS ON HAND: ${req.materialsOwned.join("; ")}`);
    lines.push(
      "Ideas should consume those materials first; small add-ons (screws, glue) are fine — say so in why_it_fits."
    );
  }
  if (req.description) lines.push(`USER NOTES: ${req.description}`);
  lines.push(`SKILL LEVEL: ${req.skillLevel}`);
  lines.push(`DISPLAY UNITS: ${req.units} (describe sizes in the summary however reads naturally)`);
  lines.push("");
  lines.push("Return the ideas as JSON matching the schema.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// DIAGNOSE — "Fix it" entry mode (Sol — safety-critical per routing plan §4)
// ---------------------------------------------------------------------------

export const diagnosisSchema = z.object({
  /** what's likely broken, one line */
  likely_cause: z.string(),
  /** 0–1 */
  confidence: z.number().min(0).max(1),
  /** what the user can check/confirm before building a repair plan */
  checks: z.array(z.string()).min(0).max(5),
  /** true → licensed-trade territory: do NOT offer a repair plan */
  call_a_pro: z.boolean(),
  /** why call_a_pro, or extra safety context */
  pro_reason: z.string().nullable().optional(),
  /** short repair outline feeding the plan generation */
  repair_summary: z.string(),
  /** what object/area this diagnosis covers (echo for the UI) */
  subject: z.string(),
});
export type Diagnosis = z.infer<typeof diagnosisSchema>;

export const DIAGNOSE_SYSTEM_PROMPT = `
You are a veteran repair technician and carpenter diagnosing a broken item from photos. Be honest about uncertainty — confidence below 0.5 means "probably, but verify". Safety rules are absolute: anything involving mains wiring, gas, structural framing of a building, pressurized plumbing, or load-bearing vehicle parts → call_a_pro = true and DO NOT suggest DIY repair. Small appliance internals, furniture, doors, drawers, fences, decks and similar are fine to diagnose for repair. Return ONLY JSON matching the schema.
`.trim();

export function buildDiagnosisMessage(req: {
  description?: string;
  units: string;
}): string {
  return [
    "Diagnose what's wrong with the item in the photo(s).",
    req.description ? `USER SAYS: ${req.description}` : null,
    `DISPLAY UNITS: ${req.units}`,
    "",
    "Return the diagnosis as JSON matching the schema.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// CHAT — "I'm stuck" per-step help (Luna; Sol when the user flags a bad answer)
// ---------------------------------------------------------------------------

export const chatReplySchema = z.object({
  /** the answer — direct, concrete, 2–6 sentences */
  reply: z.string(),
  /** true when the issue needs a different tool/material the plan didn't list */
  needs_extra_tools: z.boolean().nullable().optional(),
  /** true when the answer affects safety — UI shows it highlighted */
  safety_related: z.boolean().nullable().optional(),
});
export type ChatReply = z.infer<typeof chatReplySchema>;

export const CHAT_SYSTEM_PROMPT = `
You are a patient master carpenter helping a DIYer mid-build. You know their whole plan and which step they're on. Answer concretely: what to check, what the numbers should be, what to do next. If they send a progress photo, look at it — call out what's right, what's off, and the exact fix. If the photo shows something unsafe (wrong joint, missing fastener, splitting wood), say so plainly and put safety_related: true. Never guess about structure — if unsure, say what to measure or check. Keep replies short: they're in a garage, on a phone. Return ONLY JSON matching the schema.
`.trim();

export interface ChatContextMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildChatMessages(req: {
  planJson: string;
  step?: { n: number; title: string; text: string };
  history: ChatContextMessage[];
  question: string;
  hasImage: boolean;
}): { role: string; content: string }[] {
  const ctx = [
    `PLAN:\n${req.planJson}`,
    req.step
      ? `CURRENT STEP: #${req.step.n} "${req.step.title}" — ${req.step.text}`
      : null,
    req.hasImage
      ? "The user attached a progress photo — inspect it against this step's expected result."
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "user", content: ctx },
    ...req.history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: req.question },
  ];
}
