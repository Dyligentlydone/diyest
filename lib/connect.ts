/**
 * Stripe Connect (Express) — creator payout accounts for the plan
 * marketplace. Sales run as destination charges on diyest's platform
 * account with a PLATFORM_FEE_PCT application fee; the remainder lands in
 * the creator's Stripe balance and pays out to their bank.
 */
import { appUrl, stripe } from "./billing";
import { createServiceClient } from "./supabase/server";

export const PLATFORM_FEE_PCT = 10;

export function feeCents(priceCents: number): number {
  return Math.round((priceCents * PLATFORM_FEE_PCT) / 100);
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/** Get or lazily create the creator's Express account. */
export async function connectAccountId(
  userId: string,
  email: string | undefined
): Promise<string | null> {
  const s = stripe();
  if (!s) return null;
  const service = createServiceClient();
  const { data: prof } = await service
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .maybeSingle();
  if (prof?.stripe_account_id) return prof.stripe_account_id as string;

  const acct = await s.accounts.create({
    type: "express",
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { userId },
  });
  await service
    .from("profiles")
    .update({ stripe_account_id: acct.id })
    .eq("id", userId);
  return acct.id;
}

/** Mint a fresh onboarding link (Stripe links expire, so create per click). */
export async function onboardingLink(accountId: string): Promise<string> {
  const link = await stripe()!.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl()}/api/connect/refresh`,
    return_url: `${appUrl()}/api/connect/return`,
    type: "account_onboarding",
  });
  return link.url;
}

/** Sync charges/payouts capability flags from Stripe into the profile. */
export async function syncConnectStatus(accountId: string): Promise<void> {
  const s = stripe();
  if (!s) return;
  const acct = await s.accounts.retrieve(accountId);
  await createServiceClient()
    .from("profiles")
    .update({
      stripe_account_enabled: !!(acct.charges_enabled && acct.payouts_enabled),
    })
    .eq("stripe_account_id", accountId);
}
