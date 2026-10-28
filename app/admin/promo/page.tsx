import { Suspense } from "react";
import { requireAdmin } from "@/lib/site-mode";
import { createServiceClient } from "@/lib/supabase/server";
import { promoStatsForCode, AFFILIATE_RATE } from "@/lib/promo";
import { appUrl } from "@/lib/billing";
import { CopyButton } from "@/components/copy-button";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

async function PromoAdmin() {
  await requireAdmin();
  const supabase = createServiceClient();
  const { data: codes } = await supabase
    .from("invite_codes")
    .select("code, share_token")
    .eq("kind", "promo")
    .order("created_at", { ascending: false });

  const base = appUrl();
  const stats = await Promise.all(
    (codes ?? []).map(async (c) => ({
      token: c.share_token as string,
      stats: await promoStatsForCode(c.code),
    }))
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Creator promo codes. Each share link is a private read-only stats page —
        send it to the creator so they can watch their numbers live. Create
        codes on the Invites tab.
      </p>

      {!stats.length && (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          No promo codes yet — create one on{" "}
          <a href="/admin/invites" className="underline">Invites</a> with type
          &quot;Promo&quot;.
        </p>
      )}

      {stats.map(({ token, stats: s }) => {
        if (!s) return null;
        const shareUrl = `${base}/promo/${token}`;
        const summary = `${s.code} (${s.label ?? "creator"}) — ${s.signups} signups, ${s.plansGenerated} plans generated, ${s.sharedPlans} shared publicly, ${s.activeSubscribers} paying → est. $${s.estMonthlyUsd.toFixed(2)}/mo commission`;
        const conv = s.signups ? Math.round((s.plansGenerated / s.signups) * 10) / 10 : 0;
        return (
          <section key={s.code} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-mono text-lg font-semibold">{s.code}</h2>
              {s.label && <span className="text-sm">{s.label}</span>}
              {s.linkedCode && (
                <span className="text-xs text-muted-foreground">→ {s.linkedCode}</span>
              )}
              {!s.isActive && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                  INACTIVE
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <CopyButton text={shareUrl} label="Copy share link" />
                <CopyButton text={summary} label="Copy summary" />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              <Stat label="Signups" value={String(s.signups)} />
              <Stat label="Plans" value={String(s.plansGenerated)} />
              <Stat label="Shared" value={String(s.sharedPlans)} />
              <Stat label="Waitlist" value={String(s.waitlistSignups)} />
              <Stat label="Plans/user" value={String(conv)} />
              <Stat
                label={`Est. ${Math.round(AFFILIATE_RATE * 100)}% comm.`}
                value={`$${s.estMonthlyUsd.toFixed(2)}/mo`}
              />
            </div>

            <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
              {shareUrl}
            </p>
          </section>
        );
      })}
    </div>
  );
}

export default function AdminPromoPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg border bg-muted/40" />}>
      <PromoAdmin />
    </Suspense>
  );
}
