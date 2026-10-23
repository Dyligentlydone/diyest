/**
 * Usage accounting & limits (brief §5.8). Enforced server-side.
 * Anonymous users: 1 plan, tracked via a signed-ish cookie count (best-effort —
 * cookies can be cleared; real enforcement is per-account).
 */
import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const ANON_COOKIE = "diyest_anon_gens";
export const ANON_FREE_PLANS = 1;

export type UsageKind =
  | "plan_generate"
  | "plan_modify"
  | "chat_message"
  | "diagnosis"
  | "ideas";

export function anonGenerationsUsed(request: NextRequest): number {
  const v = Number(request.cookies.get(ANON_COOKIE)?.value ?? "0");
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function freePlansPerMonth(): number {
  return Number(process.env.FREE_PLANS_PER_MONTH ?? "3") || 3;
}

/** Count this calendar month's usage events of a kind for a user. */
export async function usageThisMonth(userId: string, kind: UsageKind): Promise<number> {
  const supabase = createServiceClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", monthStart.toISOString());
  return count ?? 0;
}

export async function recordUsage(userId: string, kind: UsageKind): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("usage_events").insert({ user_id: userId, kind });
}

export async function isPro(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan_tier")
    .eq("id", userId)
    .maybeSingle();
  return data?.plan_tier === "pro";
}

/** Can this user (or anonymous visitor) generate a plan right now? */
export async function canGenerate(
  request: NextRequest,
  userId: string | null
): Promise<{ allowed: boolean; remaining: number | null; reason?: string }> {
  if (!userId) {
    const used = anonGenerationsUsed(request);
    return used >= ANON_FREE_PLANS
      ? { allowed: false, remaining: 0, reason: "anonymous_limit" }
      : { allowed: true, remaining: ANON_FREE_PLANS - used };
  }
  if (await isPro(userId)) return { allowed: true, remaining: null };
  const free = freePlansPerMonth();
  const used = await usageThisMonth(userId, "plan_generate");
  return used >= free
    ? { allowed: false, remaining: 0, reason: "monthly_limit" }
    : { allowed: true, remaining: free - used };
}

export async function logGeneration(entry: {
  project_id?: string;
  user_id?: string | null;
  prompt_version: string;
  raw_output?: string;
  validation_errors?: unknown;
  latency_ms?: number;
  tokens?: number;
  /** §8 per-call cost columns (migration 0003) */
  stage?: string;
  model?: string;
  tier?: string;
  input_tokens?: number;
  cached_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cost_usd?: number;
}): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from("generation_logs").insert(entry);
  } catch {
    // logging must never break generation
  }
}

/**
 * §8 daily spend alert — sums today's generation_logs cost_usd. When the
 * threshold is crossed we log loudly; wire an email provider (Resend/Postmark)
 * into notifyOwner() when one exists.
 */
export async function checkDailySpend(thresholdUsd: number): Promise<void> {
  try {
    const supabase = createServiceClient();
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("generation_logs")
      .select("cost_usd")
      .gte("created_at", dayStart.toISOString());
    const total = (data ?? []).reduce(
      (s, r) => s + (Number((r as { cost_usd?: number }).cost_usd) || 0),
      0
    );
    if (total > thresholdUsd)
      console.error(
        `[SPEND ALERT] diyest daily AI spend $${total.toFixed(2)} exceeds DAILY_SPEND_ALERT_USD $${thresholdUsd} — notify owner`
      );
  } catch {
    // never break generation on alerting
  }
}
