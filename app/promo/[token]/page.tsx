import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { promoStatsForToken } from "@/lib/promo";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Creator stats — diyest",
  robots: { index: false },
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function PromoSharePage(props: {
  params: Promise<{ token: string }>;
}) {
  if (!isSupabaseConfigured()) notFound();
  const { token } = await props.params;
  const s = await promoStatsForToken(token);
  if (!s) notFound();

  const maxPlans = Math.max(1, ...s.daily.map((d) => d.plans + d.signups));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-14">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="diyest" className="mx-auto h-12 w-auto" />
        <h1 className="mt-4 text-2xl font-bold">
          {s.label ?? "Creator"} — diyest stats
        </h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          Code: {s.code} · live numbers, updated on every visit
        </p>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Signups" value={String(s.signups)} hint={`of ${s.maxUses} redemptions`} />
        <Stat label="Plans generated" value={String(s.plansGenerated)} />
        <Stat label="Shared publicly" value={String(s.sharedPlans)} />
        <Stat label="Waitlist joins" value={String(s.waitlistSignups)} />
        <Stat label="Paying subscribers" value={String(s.activeSubscribers)} />
        <Stat
          label="Est. commission"
          value={`$${s.estMonthlyUsd.toFixed(2)}/mo`}
          hint="at 10% of subscriptions"
        />
      </div>

      <div className="mt-8 rounded-xl border p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Last 30 days
        </p>
        <div className="mt-4 flex h-24 items-end gap-1">
          {s.daily.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.signups} signups, ${d.plans} plans`}
              className="flex-1 rounded-sm bg-primary/70"
              style={{
                height: `${Math.max(2, ((d.signups + d.plans) / maxPlans) * 100)}%`,
              }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{s.daily[0]?.date}</span>
          <span>{s.daily[s.daily.length - 1]?.date}</span>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Signups = people who redeemed your code · Commission estimates update as
        subscribers join · diyest.com
      </p>
    </main>
  );
}
