import { NextRequest, NextResponse } from "next/server";
import { denyIfNoInvite, isInviteOnly } from "@/lib/site-mode";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { chatModel, diagnoseModel, getOpenAI, reasoningEffort, supportsTemperature } from "@/lib/ai/openai";
import {
  buildChatMessages,
  CHAT_PROMPT_VERSION,
  CHAT_SYSTEM_PROMPT,
  chatReplySchema,
} from "@/lib/ai/prompts/m4";
import { stripImageDataUrl } from "@/lib/image";
import { usageOf } from "@/lib/ai/usage-of";
import { checkAllowance } from "@/lib/limits";
import { logGeneration, recordUsage } from "@/lib/usage";
import { planSchema } from "@/lib/plan/schema";

const payloadSchema = z.object({
  plan: planSchema,
  step: z
    .object({ n: z.number().int(), title: z.string(), text: z.string() })
    .optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .default([]),
  question: z.string().min(1).max(2000),
  image: z.string().optional(), // progress-photo data URL
  /** user flagged the previous answer as wrong → escalate this turn to Sol */
  escalate: z.boolean().default(false),
  projectId: z.string().uuid().optional(),
});

/** POST — "I'm stuck" per-step chat + progress-photo checks (Luna; Sol on flag). */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isInviteOnly()) {
    if (!user)
      return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
    const denied = await denyIfNoInvite(user.id);
    if (denied) return denied;
  }

  let body: z.infer<typeof payloadSchema>;
  try {
    body = payloadSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let accessLevel: "basic" | "intermediate" | "pro" = "basic";
  let chatUsed = 0;
  if (body.projectId && user) {
    const { data: proj } = await supabase
      .from("projects")
      .select("access_level, chat_messages_used")
      .eq("id", body.projectId)
      .maybeSingle();
    if (proj) {
      accessLevel = (proj.access_level as typeof accessLevel) ?? "basic";
      chatUsed = proj.chat_messages_used ?? 0;
    }
  }
  const check = checkAllowance(accessLevel, "chatMessages", chatUsed);

  const model = body.escalate ? diagnoseModel() : chatModel();
  const start = Date.now();

  const messages = buildChatMessages({
    planJson: JSON.stringify(body.plan),
    step: body.step,
    history: body.history,
    question: body.question,
    hasImage: !!body.image,
  }) as { role: string; content: string }[];

  const lastUser = messages[messages.length - 1];
  if (body.image && lastUser.role === "user") {
    // strip EXIF/GPS from the progress photo before it reaches the model
    const cleanImage = await stripImageDataUrl(body.image);
    messages[messages.length - 1] = {
      role: "user",
      content: [
        { type: "text", text: lastUser.content },
        { type: "image_url", image_url: { url: cleanImage, detail: "high" } },
      ],
    } as never;
  }

  const completion = await getOpenAI().chat.completions.parse(
    {
      model,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        ...(messages as never[]),
      ],
      response_format: zodResponseFormat(chatReplySchema, "chat_reply"),
      ...(supportsTemperature(model) ? { temperature: 0.4 } : {}),
      ...(reasoningEffort(model)
        ? { reasoning_effort: body.escalate ? ("medium" as const) : ("low" as const) }
        : {}),
    },
    { timeout: 90_000, maxRetries: 1 }
  );
  const usage = usageOf(completion.usage);
  void logGeneration({
    user_id: user?.id,
    project_id: body.projectId,
    prompt_version: CHAT_PROMPT_VERSION,
    stage: body.escalate ? "chat_escalated" : "chat",
    model,
    input_tokens: usage.inputTokens,
    cached_tokens: usage.cachedTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    latency_ms: Date.now() - start,
    tokens: usage.inputTokens + usage.outputTokens,
  });
  if (user) void recordUsage(user.id, "chat_message");
  if (body.projectId && user)
    void supabase
      .from("projects")
      .update({ chat_messages_used: chatUsed + 1 })
      .eq("id", body.projectId);

  const reply = completion.choices[0]?.message?.parsed ?? null;
  if (!reply)
    return NextResponse.json(
      { error: "No answer came back — try rephrasing" },
      { status: 422 }
    );
  return NextResponse.json({
    ok: true,
    reply,
    usage: {
      kind: "chatMessages",
      ...check,
      used: chatUsed + 1,
      remaining: Math.max(0, check.limit - chatUsed - 1),
    },
  });
}
