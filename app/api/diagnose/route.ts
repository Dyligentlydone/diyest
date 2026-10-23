import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { diagnoseModel, getOpenAI, reasoningEffort, supportsTemperature } from "@/lib/ai/openai";
import {
  buildDiagnosisMessage,
  DIAGNOSE_PROMPT_VERSION,
  DIAGNOSE_SYSTEM_PROMPT,
  diagnosisSchema,
} from "@/lib/ai/prompts/m4";
import { usageOf } from "@/lib/ai/usage-of";
import { logGeneration, recordUsage } from "@/lib/usage";

const payloadSchema = z.object({
  description: z.string().max(2000).optional(),
  units: z.enum(["metric", "imperial"]).default("metric"),
  images: z.array(z.string()).min(1).max(4), // at least one photo required
});

/** POST — safety-critical fix-it diagnosis (Sol per routing plan §4). */
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
    return NextResponse.json(
      { error: "A photo of the problem is required" },
      { status: 400 }
    );
  }

  const model = diagnoseModel();
  const userMsg = buildDiagnosisMessage(body);
  const start = Date.now();
  const completion = await getOpenAI().chat.completions.parse(
    {
      model,
      messages: [
        { role: "system", content: DIAGNOSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text" as const, text: userMsg },
            ...body.images.map((url) => ({
              type: "image_url" as const,
              image_url: { url, detail: "high" as const },
            })),
          ],
        },
      ],
      response_format: zodResponseFormat(diagnosisSchema, "diagnosis"),
      ...(supportsTemperature(model) ? { temperature: 0.2 } : {}),
      ...(reasoningEffort(model) ? { reasoning_effort: reasoningEffort(model)! } : {}),
    },
    { timeout: 120_000, maxRetries: 1 }
  );
  const usage = usageOf(completion.usage);
  void logGeneration({
    user_id: user?.id,
    prompt_version: DIAGNOSE_PROMPT_VERSION,
    stage: "diagnose",
    model,
    input_tokens: usage.inputTokens,
    cached_tokens: usage.cachedTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    latency_ms: Date.now() - start,
    tokens: usage.inputTokens + usage.outputTokens,
    raw_output: completion.choices[0]?.message?.content ?? "",
  });
  if (user) void recordUsage(user.id, "diagnosis");

  const diagnosis = completion.choices[0]?.message?.parsed ?? null;
  if (!diagnosis)
    return NextResponse.json(
      { error: "Couldn't diagnose this one — try a clearer photo" },
      { status: 422 }
    );
  return NextResponse.json({ ok: true, diagnosis });
}
