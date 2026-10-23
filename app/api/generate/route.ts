import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generatePlan, type GenEvent } from "@/lib/ai/generate";
import { PROMPT_VERSION } from "@/lib/ai/prompts/plan.v1.5";
import { REVIEW_PROMPT_VERSION } from "@/lib/ai/prompts/review.v1";
import type { PlanRequest } from "@/lib/ai/prompts/plan.v1.5";
import {
  ANON_COOKIE,
  anonGenerationsUsed,
  canGenerate,
  checkDailySpend,
  logGeneration,
  recordUsage,
  usageThisMonth,
  usageToday,
} from "@/lib/usage";
import { dailySpendAlertUsd } from "@/lib/ai/pricing";
import { isSupabaseConfigured } from "@/lib/env";
import { cachedPlan, requestHash, storePlan } from "@/lib/plan/cache";
import { planModel, reviewModel, escalationModel } from "@/lib/ai/openai";
import { betaCanGenerate, isInviteOnly, requireApiAccess } from "@/lib/site-mode";
import { stripImageDataUrl } from "@/lib/image";

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
  useMyToolsOnly: z.boolean().default(false),
  toolsOwned: z.array(z.string().max(80)).max(60).optional(),
  // M4 entry modes
  mode: z.enum(["build", "fix", "space", "leftovers", "describe"]).default("build"),
  chosenIdea: z.string().max(400).optional(),
  diagnosis: z.string().max(2000).optional(),
  materialsOwned: z.array(z.string().max(200)).max(20).optional(),
  spaceConstraintsMm: z
    .object({
      width: z.number().positive().optional(),
      depth: z.number().positive().optional(),
      height: z.number().positive().optional(),
    })
    .optional(),
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
      // strip EXIF/GPS before the bytes leave our hands (model + logs)
      imageDataUrls.push(
        await stripImageDataUrl(`data:${f.type};base64,${buf.toString("base64")}`)
      );
    }
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : "Malformed request";
    return NextResponse.json(
      { ok: false, kind: "invalid", errors: [msg ?? "Malformed request"] },
      { status: 400 }
    );
  }

  // ---- auth + limits ----
  let user: { id: string } | null = null;
  const supabase = isSupabaseConfigured() ? await createClient() : null;

  if (isInviteOnly()) {
    // invite-only beta: signed-in + active invite required, beta caps apply
    const gate = await requireApiAccess();
    if ("response" in gate) return gate.response;
    user = { id: gate.userId };
    const [usedToday, usedMonth] = await Promise.all([
      usageToday(gate.userId, "plan_generate"),
      usageThisMonth(gate.userId, "plan_generate"),
    ]);
    const cap = betaCanGenerate(usedToday, usedMonth);
    if (!cap.allowed)
      return NextResponse.json(
        {
          ok: false,
          kind: "limit",
          reason: cap.reason,
          errors: [
            cap.reason === "beta_daily_limit"
              ? "Beta limit: that's all the plans for today — more tomorrow."
              : "Beta limit: monthly plan cap reached. Ask us for more.",
          ],
        },
        { status: 429 }
      );
  } else {
    const {
      data: { user: u },
    } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    user = u;
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
  }

  // ---- generate ----
  const req: PlanRequest = {
    mode: payload.mode,
    description: payload.description,
    chosenIdea: payload.chosenIdea,
    diagnosis: payload.diagnosis,
    materialsOwned: payload.materialsOwned,
    spaceConstraintsMm: payload.spaceConstraintsMm,
    targetDimensionsMm: payload.targetDimensionsMm,
    units: payload.units,
    skillLevel: payload.skillLevel,
    budget: payload.budget,
    style: payload.style,
    useMyToolsOnly: payload.useMyToolsOnly,
    toolsOwned: payload.toolsOwned,
    clarificationAnswers: payload.clarificationAnswers,
    currency: payload.currency,
    imageCount: imageDataUrls.length,
  };

  // ---- plan cache: identical request → checked plan, zero model calls ----
  // salted with prompt versions + model names so a model/prompt change
  // invalidates cached plans automatically
  const hash = requestHash(
    payload as Record<string, unknown>,
    imageDataUrls,
    [PROMPT_VERSION, REVIEW_PROMPT_VERSION, planModel(), reviewModel(), escalationModel()]
      .filter(Boolean)
      .join("|")
  );
  let cached: Awaited<ReturnType<typeof cachedPlan>> = null;
  if (supabase && user) {
    try {
      cached = await cachedPlan(supabase, hash);
    } catch {
      /* cache unavailable → generate normally */
    }
  }

  // ---- generate (NDJSON stream: "plan" fast, "final" after review+repair) ----
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: GenEvent) =>
        controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      try {
        if (cached) {
          const result = {
            ok: true as const,
            plan: cached.plan,
            unverified: cached.unverified,
            blockers: cached.blockers,
            warnings: cached.warnings,
            promptVersion: PROMPT_VERSION,
            model: "cache",
            latencyMs: 0,
            firstMetaMs: 0,
            firstPlanMs: 0,
            tokens: 0,
            costUsd: 0,
            calls: [],
            repairCount: 0,
            improved: false,
            escalated: null,
            review: null,
            reviewPending: cached.reviewPending,
            raw: "",
          };
          send({ type: "meta", title: cached.plan.title, summary: cached.plan.summary });
          send({ type: "plan", plan: cached.plan, unverified: cached.unverified, warnings: cached.warnings, promptVersion: PROMPT_VERSION, firstPlanMs: 0 });
          send({ type: "final", result });
          if (user) void recordUsage(user.id, "plan_generate");
          return;
        }
        const result = await generatePlan(
          req,
          imageDataUrls,
          {
            targetDimensionsMm: payload.targetDimensionsMm,
            toolsOwned: payload.toolsOwned,
            useMyToolsOnly: payload.useMyToolsOnly,
          },
          send
        );

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
        // §8: one row per model call — model/tier/stage/token split/$ cost
        if (result.ok)
          for (const c of result.calls)
            void logGeneration({
              user_id: user?.id,
              prompt_version: result.promptVersion,
              stage: c.stage,
              model: c.model,
              tier: c.tier,
              input_tokens: c.usage.inputTokens,
              cached_tokens: c.usage.cachedTokens,
              output_tokens: c.usage.outputTokens,
              reasoning_tokens: c.usage.reasoningTokens,
              cost_usd: c.costUsd,
              latency_ms: c.latencyMs,
              tokens: c.usage.inputTokens + c.usage.outputTokens,
              validation_errors: result.blockers.length
                ? { blockers: result.blockers }
                : undefined,
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
        // cache checked plans for identical future requests
        if (result.ok && supabase && user)
          void storePlan(supabase, hash, result.promptVersion, {
            plan: result.plan,
            unverified: result.unverified,
            blockers: result.blockers,
            warnings: result.warnings,
            reviewPending: result.reviewPending,
          });
        void checkDailySpend(dailySpendAlertUsd());
        if (user) void recordUsage(user.id, "plan_generate");
      } catch (e) {
        console.error("[generate] failed", e);
        send({
          type: "error",
          result: {
            ok: false,
            kind: "invalid",
            errors: ["Plan generation failed. Try again."],
            raw: "",
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  const res = new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
  if (!user) {
    res.headers.append(
      "set-cookie",
      `${ANON_COOKIE}=${anonGenerationsUsed(request) + 1}; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}; Path=/`
    );
  }
  return res;
}
