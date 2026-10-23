import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generatePlan } from "@/lib/ai/generate";
import { PROMPT_VERSION } from "@/lib/ai/prompts/plan.v1.3";
import { REVIEW_PROMPT_VERSION } from "@/lib/ai/prompts/review.v1";
import type { PlanRequest } from "@/lib/ai/prompts/plan.v1.3";
import {
  ANON_COOKIE,
  anonGenerationsUsed,
  canGenerate,
  logGeneration,
  recordUsage,
} from "@/lib/usage";
import { isSupabaseConfigured } from "@/lib/env";

const payloadSchema = z.object({
  description: z.string().max(4000).optional(),
  targetDimensionsMm: z
    .object({
      width: z.number().positive().max(100000).optional(),
      depth: z.number().positive().max(100000).optional(),
      height: z.number().positive().max(100000).optional(),
    })
    .partial()
    .optional(),
  units: z.enum(["metric", "imperial"]).default("metric"),
  skillLevel: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  budget: z.enum(["budget", "balanced", "premium"]).default("balanced"),
  style: z
    .enum(["match_photo", "rustic", "modern", "scandinavian", "industrial"])
    .default("match_photo"),
  clarificationAnswers: z
    .array(z.object({ question: z.string(), answer: z.string().max(2000) }))
    .max(6)
    .optional(),
  currency: z.string().length(3).default("USD"),
});

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  // ---- parse multipart form ----
  let payload: z.infer<typeof payloadSchema>;
  const imageDataUrls: string[] = [];
  try {
    const form = await request.formData();
    payload = payloadSchema.parse(JSON.parse(String(form.get("payload") ?? "{}")));

    const files = form.getAll("images").filter((f): f is File => f instanceof File);
    if (files.length > MAX_IMAGES) {
      return NextResponse.json(
        { ok: false, kind: "invalid", errors: [`At most ${MAX_IMAGES} images`] },
        { status: 400 }
      );
    }
    for (const f of files) {
      if (f.size === 0) continue;
      if (f.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { ok: false, kind: "invalid", errors: [`Image "${f.name}" is too large`] },
          { status: 400 }
        );
      }
      if (!IMAGE_TYPES.has(f.type)) {
        return NextResponse.json(
          {
            ok: false,
            kind: "invalid",
            errors: [`Image "${f.name}" must be JPEG or PNG (HEIC is converted in the browser)`],
          },
          { status: 400 }
        );
      }
      const buf = Buffer.from(await f.arrayBuffer());
      imageDataUrls.push(`data:${f.type};base64,${buf.toString("base64")}`);
    }
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : "Malformed request";
    return NextResponse.json(
      { ok: false, kind: "invalid", errors: [msg ?? "Malformed request"] },
      { status: 400 }
    );
  }

  // ---- auth + limits ----
  const supabase = isSupabaseConfigured() ? await createClient() : null;
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  const limit = await canGenerate(request, user?.id ?? null);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        kind: "limit",
        reason: limit.reason,
        errors:
          limit.reason === "anonymous_limit"
            ? ["Sign up to keep generating plans — it's free."]
            : ["You've used all your free plans this month."],
      },
      { status: 429 }
    );
  }

  // ---- generate ----
  const req: PlanRequest = {
    mode: "build",
    description: payload.description,
    targetDimensionsMm: payload.targetDimensionsMm,
    units: payload.units,
    skillLevel: payload.skillLevel,
    budget: payload.budget,
    style: payload.style,
    useMyToolsOnly: false,
    clarificationAnswers: payload.clarificationAnswers,
    currency: payload.currency,
    imageCount: imageDataUrls.length,
  };

  try {
    const result = await generatePlan(req, imageDataUrls, {
      targetDimensionsMm: payload.targetDimensionsMm,
    });

    void logGeneration({
      user_id: user?.id,
      prompt_version: result.ok ? result.promptVersion : PROMPT_VERSION,
      raw_output: result.raw,
      validation_errors: result.ok
        ? result.unverified.length
          ? result.unverified
          : undefined
        : result.kind === "invalid"
          ? result.errors
          : [{ kind: result.kind }],
      latency_ms: result.ok ? result.latencyMs : undefined,
      tokens: result.ok ? result.tokens : undefined,
    });
    if (result.ok && result.review)
      void logGeneration({
        user_id: user?.id,
        prompt_version: REVIEW_PROMPT_VERSION,
        raw_output: JSON.stringify(result.review),
        validation_errors: result.review.issues.length
          ? result.review.issues
          : undefined,
        latency_ms: result.review.latencyMs,
        tokens: result.review.tokens,
      });
    if (user) void recordUsage(user.id, "plan_generate");

    const res = NextResponse.json(result);
    if (!user) {
      res.cookies.set(ANON_COOKIE, String(anonGenerationsUsed(request) + 1), {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }
    return res;
  } catch (e) {
    console.error("[generate] failed", e);
    return NextResponse.json(
      { ok: false, kind: "error", errors: ["Plan generation failed. Try again."] },
      { status: 500 }
    );
  }
}
