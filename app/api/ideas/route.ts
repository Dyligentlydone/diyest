import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getOpenAI, ideasModel, reasoningEffort, supportsTemperature } from "@/lib/ai/openai";
import { buildIdeasMessage, ideasSchema, IDEAS_PROMPT_VERSION, IDEAS_SYSTEM_PROMPT } from "@/lib/ai/prompts/m4";
import { usageOf } from "@/lib/ai/usage-of";
import { logGeneration, recordUsage } from "@/lib/usage";

const payloadSchema = z.object({
  mode: z.enum(["space", "leftovers"]),
  description: z.string().max(2000).optional(),
  spaceMm: z
    .object({
      width: z.number().positive().optional(),
      depth: z.number().positive().optional(),
      height: z.number().positive().optional(),
    })
    .optional(),
  materialsOwned: z.array(z.string().max(200)).max(20).optional(),
  skillLevel: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  units: z.enum(["metric", "imperial"]).default("metric"),
  images: z.array(z.string()).max(4).default([]), // data URLs
});

/** POST — 3–5 project ideas for a space or a pile of leftover materials (Luna). */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: z.infer<typeof payloadSchema>;
  try {
    body = payloadSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const model = ideasModel();
  const userMsg = buildIdeasMessage(body);
  const start = Date.now();
  const completion = await getOpenAI().chat.completions.parse(
    {
      model,
      messages: [
        { role: "system", content: IDEAS_SYSTEM_PROMPT },
        {
          role: "user",
          content: body.images.length
            ? [
                { type: "text" as const, text: userMsg },
                ...body.images.map((url) => ({
                  type: "image_url" as const,
                  image_url: { url },
                })),
              ]
            : userMsg,
        },
      ],
      response_format: zodResponseFormat(ideasSchema, "ideas"),
      ...(supportsTemperature(model) ? { temperature: 0.5 } : {}),
      ...(reasoningEffort(model) ? { reasoning_effort: "low" as const } : {}),
    },
    { timeout: 120_000, maxRetries: 1 }
  );
  const usage = usageOf(completion.usage);
  void logGeneration({
    user_id: user?.id,
    prompt_version: IDEAS_PROMPT_VERSION,
    stage: "ideas",
    model,
    input_tokens: usage.inputTokens,
    cached_tokens: usage.cachedTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    latency_ms: Date.now() - start,
    tokens: usage.inputTokens + usage.outputTokens,
    raw_output: completion.choices[0]?.message?.content ?? "",
  });
  if (user) void recordUsage(user.id, "ideas");

  const ideas = (completion.choices[0]?.message?.parsed as { ideas?: unknown[] } | null)?.ideas ?? [];
  return NextResponse.json({ ok: true, ideas });
}
