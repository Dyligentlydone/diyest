import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { betaAccessFor, denyPageIfNoInvite } from "@/lib/site-mode";
import { createClient } from "@/lib/supabase/server";
import { billingEnabled, billingState, TIERS } from "@/lib/billing";
import { formatCents, PLATFORM_FEE_PCT } from "@/lib/connect";
import { PortalButton } from "@/components/checkout-button";
import { ConnectPayoutsButton } from "@/components/connect-payouts-button";
import Link from "next/link";
import type { Profile } from "@/lib/types";
import { SettingsForm } from "./settings-form";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Settings — diyest", robots: { index: false } };

async function SettingsContent() {
  if (!isSupabaseConfigured()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profile &amp; defaults</CardTitle>
          <CardDescription>
            Supabase is not configured yet — sign in and profile settings will
            appear here once it is.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings");
  await denyPageIfNoInvite();

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const profile: Profile = (data as Profile | null) ?? {
    id: user.id,
    display_name: null,
    units: "metric",
    skill_level: "beginner",
    kerf_mm: 3,
    stock_sizes: {},
    tools_owned: [],
    plan_tier: "free",
    stripe_customer_id: null,
    created_at: "",
    updated_at: "",
  };

  const billing = await billingState(user.id);
  const access = await betaAccessFor(user.id);

  // marketplace earnings (seller's own sales — RLS lets sellers read them)
  const { data: sales } = await supabase
    .from("plan_purchases")
    .select("amount_cents, fee_cents, created_at, refunded_at")
    .eq("seller_id", user.id);
  const liveSales = (sales ?? []).filter((s) => !s.refunded_at);
  const earnedCents = liveSales.reduce(
    (sum, s) => sum + (s.amount_cents - s.fee_cents),
    0
  );
  const payoutsConnected = !!profile.stripe_account_enabled;
  const tierCfg = billing.tier
    ? TIERS.find((t) => t.tier === billing.tier)
    : null;
  // invite grants map onto paid tiers for display: basic→starter,
  // intermediate→workshop, pro→pro
  const grantTier =
    !tierCfg && access?.active
      ? TIERS.find(
          (t) =>
            t.tier ===
            (access.level === "pro"
              ? "pro"
              : access.level === "intermediate"
                ? "workshop"
                : "starter")
        )
      : null;
  const planLabel = tierCfg ? `${tierCfg.name} — $${tierCfg.priceUsd}/mo` : null;
  const creditLabel =
    billing.credits > 0
      ? `${billing.credits} plan credit${billing.credits === 1 ? "" : "s"}`
      : null;

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Plan &amp; billing</CardTitle>
          <CardDescription>
            {planLabel ??
              (grantTier ? (
                <span>
                  {grantTier.name} —{" "}
                  <span className="line-through">${grantTier.priceUsd}/mo</span>
                </span>
              ) : (
                creditLabel ?? "Free"
              ))}
            {grantTier && (
              <span className="mt-0.5 block text-xs">Free (invited)</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {billing.active && billing.currentPeriodEnd && (
            <p className="text-sm text-muted-foreground">
              Renews{" "}
              {new Date(billing.currentPeriodEnd).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
              })}
              {billing.status === "past_due" && " — payment failed, update your card"}
            </p>
          )}
          {billing.credits > 0 && billing.active && (
            <p className="mt-1 text-sm text-muted-foreground">
              Plus {billing.credits} single-plan credit
              {billing.credits === 1 ? "" : "s"} banked.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {billing.customerId && (
              <PortalButton className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted">
                Manage billing
              </PortalButton>
            )}
            {billingEnabled() && billing.tier !== "pro" && (
              <Link
                href="/pricing"
                className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {billing.active ? "Change plan" : "See plans"}
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {billingEnabled() && (
        <Card className="mb-6" id="payouts">
          <CardHeader>
            <CardTitle>Sell your plans</CardTitle>
            <CardDescription>
              Charge for plans you share publicly — buyers get an instant copy.
              diyest takes a {PLATFORM_FEE_PCT}% fee; the rest pays out to your
              bank via Stripe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {liveSales.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {liveSales.length} sale{liveSales.length === 1 ? "" : "s"} ·{" "}
                {formatCents(earnedCents)} earned
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ConnectPayoutsButton className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                {payoutsConnected
                  ? "Payouts connected — manage in Stripe"
                  : profile.stripe_account_id
                    ? "Finish payout setup"
                    : "Set up payouts"}
              </ConnectPayoutsButton>
              {payoutsConnected ? (
                <span className="text-xs text-muted-foreground">
                  You can now set a price when sharing a project.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Stripe Express — link a bank account, ~2 minutes.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Set a password to sign in with email + password instead of a
            sign-in link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile &amp; defaults</CardTitle>
          <CardDescription>
            These defaults are applied to every new plan you generate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm profile={profile} email={user.email ?? ""} />
        </CardContent>
      </Card>
    </>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg border bg-muted/40" />}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
