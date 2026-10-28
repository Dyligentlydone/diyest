import type { Metadata } from "next";
import { Check } from "lucide-react";
import { CheckoutButton } from "@/components/checkout-button";
import { SINGLE_PLAN_USD, TIERS } from "@/lib/billing";
import { billingEnabled } from "@/lib/billing";

export const metadata: Metadata = {
  title: "Pricing — diyest",
  description: "Plans for every kind of builder — from one project to a full shop.",
};

const FEATURES: Record<string, string[]> = {
  starter: [
    "10 plan generations / month",
    "Photo → blueprint, cut list & joinery",
    "3D preview & printable sheets",
    "Saved projects & build mode",
  ],
  workshop: [
    "15 plan generations / month",
    "Everything in Starter",
    "Priority generation queue",
    "Plan modifications",
  ],
  pro: [
    "Unlimited plan generations",
    "Everything in Workshop",
    "Commercial use — sell what you build",
    "Priority queue & earliest features",
  ],
};

export default function PricingPage() {
  const enabled = billingEnabled();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-14">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Plans for every kind of builder
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Every plan is checked by our master-carpenter review before you see it.
          Cancel anytime.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {TIERS.map((t) => (
          <div
            key={t.tier}
            className={`flex flex-col rounded-xl border p-5 ${
              t.tier === "workshop"
                ? "border-primary shadow-md"
                : "bg-card/60"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">{t.name}</h2>
              {t.tier === "workshop" && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Most popular
                </span>
              )}
            </div>
            <p className="mt-2">
              <span className="text-3xl font-bold">${t.priceUsd}</span>
              <span className="text-sm text-muted-foreground">/mo</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t.blurb}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {FEATURES[t.tier].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <CheckoutButton
              plan={t.tier}
              className={`mt-5 h-10 w-full rounded-md text-sm font-medium ${
                t.tier === "workshop"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border hover:bg-muted"
              }`}
            >
              {enabled ? `Get ${t.name}` : `${t.name} — coming soon`}
            </CheckoutButton>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-6 max-w-md rounded-xl border p-5 text-center">
        <h2 className="font-semibold">Just one project?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A single carpenter-checked plan, no subscription.
        </p>
        <p className="mt-2">
          <span className="text-2xl font-bold">${SINGLE_PLAN_USD}</span>
          <span className="text-sm text-muted-foreground"> one-time</span>
        </p>
        <CheckoutButton
          plan="single"
          className="mt-3 h-10 w-full rounded-md border text-sm font-medium hover:bg-muted"
        >
          Buy one plan
        </CheckoutButton>
      </div>
    </main>
  );
}
