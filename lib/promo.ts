/**
 * Promo-code analytics: signups, generation activity, and commission
 * estimates per creator code. Used by /admin/promo and the public
 * token-gated /promo/[token] share page.
 */
import { createServiceClient } from "./supabase/server";
import { TIERS, type PaidTier } from "./billing";

export const AFFILIATE_RATE = 0.1;

export interface PromoStats {
  code: string;
  label: string | null;
  linkedCode: string | null;
  isActive: boolean;
  maxUses: number;
  signups: number;
  plansGenerated: number;
  sharedPlans: number;
  waitlistSignups: number;
  activeSubscribers: number;
  /** est. monthly affiliate payout at AFFILIATE_RATE of active subs */
  estMonthlyUsd: number;
  /** signups per day, oldest → newest */
  daily: { date: string; signups: number; plans: number }[];
}

export async function promoStatsForCode(code: string): Promise<PromoStats | null> {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("invite_codes")
    .select("code, label, linked_code, is_active, max_uses")
    .eq("code", code)
    .maybeSingle();
  if (!row) return null;

  // who redeemed this code
  const { data: redemptions } = await supabase
    .from("invite_redemptions")
    .select("user_id, redeemed_at")
    .eq("code", code)
    .order("redeemed_at");
  const userIds = (redemptions ?? []).map((r) => r.user_id);

  const [plansRes, sharedRes, waitlistRes, subsRes] = await Promise.all([
    userIds.length
      ? supabase
          .from("usage_events")
          .select("user_id, created_at")
          .eq("kind", "plan_generate")
          .in("user_id", userIds)
      : Promise.resolve({ data: [] as { user_id: string; created_at: string }[] }),
    userIds.length
      ? supabase.from("projects").select("user_id").eq("is_public", true).in("user_id", userIds)
      : Promise.resolve({ data: [] as { user_id: string }[] }),
    supabase
      .from("waitlist")
      .select("id", { count: "exact", head: true })
      .eq("invite_code", code),
    userIds.length
      ? supabase
          .from("subscriptions")
          .select("user_id, plan_tier, status")
          .in("user_id", userIds)
          .in("status", ["active", "trialing"])
      : Promise.resolve({ data: [] as { user_id: string; plan_tier: string | null; status: string }[] }),
  ]);

  const plans = plansRes.data ?? [];
  const shared = sharedRes.data ?? [];
  const subs = subsRes.data ?? [];

  const tierPrice = new Map<PaidTier, number>(TIERS.map((t) => [t.tier, t.priceUsd]));
  const estMonthlyUsd = subs.reduce(
    (sum, s) => sum + (tierPrice.get(s.plan_tier as PaidTier) ?? 0) * AFFILIATE_RATE,
    0
  );

  // last 30 days of activity, bucketed by UTC day
  const days: PromoStats["daily"] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push({ date: d.toISOString().slice(0, 10), signups: 0, plans: 0 });
  }
  const idx = new Map(days.map((d, i) => [d.date, i]));
  for (const r of redemptions ?? []) {
    const i = idx.get(r.redeemed_at.slice(0, 10));
    if (i != null) days[i].signups++;
  }
  for (const p of plans) {
    const i = idx.get(p.created_at.slice(0, 10));
    if (i != null) days[i].plans++;
  }

  return {
    code,
    label: row.label,
    linkedCode: row.linked_code,
    isActive: row.is_active,
    maxUses: row.max_uses,
    signups: userIds.length,
    plansGenerated: plans.length,
    sharedPlans: shared.length,
    waitlistSignups: waitlistRes.count ?? 0,
    activeSubscribers: subs.length,
    estMonthlyUsd,
    daily: days,
  };
}

/** Look up a promo code by its share token (public stats page). */
export async function promoStatsForToken(
  token: string
): Promise<PromoStats | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("invite_codes")
    .select("code")
    .eq("share_token", token)
    .eq("kind", "promo")
    .maybeSingle();
  if (!data) return null;
  return promoStatsForCode(data.code);
}
