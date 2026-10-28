/**
 * Paid billing: Stripe subscriptions (starter/workshop/pro) + one-time
 * single-plan credits. Degrades to "not configured" when STRIPE_* env is
 * absent so invite/beta flows keep working unchanged.
 */
import Stripe from "stripe";
import { createServiceClient } from "./supabase/server";

export type PaidTier = "starter" | "workshop" | "pro";

export interface TierConfig {
  tier: PaidTier;
  name: string;
  priceUsd: number;
  /** null = unlimited (fair use) */
  gensPerMonth: number | null;
  blurb: string;
}

export const TIERS: TierConfig[] = [
  {
    tier: "starter",
    name: "Starter",
    priceUsd: 9,
    gensPerMonth: 10,
    blurb: "For the occasional build — 10 plans a month, saved projects, build mode.",
  },
  {
    tier: "workshop",
    name: "Workshop",
    priceUsd: 19,
    gensPerMonth: 15,
    blurb: "For the regular builder — 15 plans a month, priority generation.",
  },
  {
    tier: "pro",
    name: "Pro",
    priceUsd: 35,
    gensPerMonth: null,
    blurb: "For shops & creators — unlimited plans, commercial use, priority queue.",
  },
];

export const SINGLE_PLAN_USD = 15;
export const SINGLE_PLAN_CREDITS = 1;

const PRICE_ENV: Record<PaidTier | "single", string> = {
  starter: "STRIPE_PRICE_STARTER",
  workshop: "STRIPE_PRICE_WORKSHOP",
  pro: "STRIPE_PRICE_PRO",
  single: "STRIPE_PRICE_SINGLE",
};

export function priceIdFor(plan: PaidTier | "single"): string | null {
  return process.env[PRICE_ENV[plan]] ?? null;
}

export function tierFromPriceId(priceId: string): PaidTier | null {
  for (const t of TIERS) if (priceIdFor(t.tier) === priceId) return t.tier;
  return null;
}

let _stripe: Stripe | null | undefined;
export function stripe(): Stripe | null {
  if (_stripe !== undefined) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  _stripe = key ? new Stripe(key) : null;
  return _stripe;
}

/** True when Stripe is wired up enough to take money. */
export function billingEnabled(): boolean {
  return !!stripe();
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export interface BillingState {
  /** active or trialing subscription */
  active: boolean;
  tier: PaidTier | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** one-time single-plan purchases remaining */
  credits: number;
  customerId: string | null;
}

/** Subscription + credits for a user — service-role read, bypasses RLS. */
export async function billingState(userId: string): Promise<BillingState> {
  const supabase = createServiceClient();
  const [{ data: sub }, { data: prof }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "status, plan_tier, current_period_start, current_period_end, stripe_customer_id"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("plan_credits, stripe_customer_id")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const active = sub?.status === "active" || sub?.status === "trialing";
  return {
    active,
    tier: active ? ((sub?.plan_tier as PaidTier | null) ?? null) : null,
    status: sub?.status ?? "none",
    currentPeriodStart: sub?.current_period_start ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    credits: prof?.plan_credits ?? 0,
    customerId: sub?.stripe_customer_id ?? prof?.stripe_customer_id ?? null,
  };
}

/** Burn one single-plan credit after a completed generation. */
export async function consumePlanCredit(userId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan_credits")
    .eq("id", userId)
    .maybeSingle();
  const next = Math.max(0, (data?.plan_credits ?? 0) - 1);
  await supabase
    .from("profiles")
    .update({ plan_credits: next })
    .eq("id", userId);
}

/** Grant credits after a one-time checkout completes. */
export async function grantPlanCredits(
  userId: string,
  n = SINGLE_PLAN_CREDITS
): Promise<void> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan_credits")
    .eq("id", userId)
    .maybeSingle();
  await supabase
    .from("profiles")
    .update({ plan_credits: (data?.plan_credits ?? 0) + n })
    .eq("id", userId);
}
