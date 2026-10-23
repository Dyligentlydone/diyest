import { Suspense } from "react";
import { requireAdmin } from "@/lib/site-mode";
import { createServiceClient } from "@/lib/supabase/server";

async function Totals() {
  await requireAdmin();
  const supabase = createServiceClient();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    waitlist,
    confirmed,
    codes,
    redemptions,
    activeUsers,
    plans,
    spendTodayRows,
    spendMonthRows,
  ] = await Promise.all([
    supabase.from("waitlist").select("id", { count: "exact", head: true }),
    supabase
      .from("waitlist")
      .select("id", { count: "exact", head: true })
      .not("confirmed_at", "is", null),
    supabase.from("invite_codes").select("id", { count: "exact", head: true }),
    supabase.from("invite_redemptions").select("id", { count: "exact", head: true }),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("beta_access_level", "is", null)
      .or(`beta_access_until.is.null,beta_access_until.gt.${new Date().toISOString()}`),
    supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "plan_generate"),
    supabase
      .from("generation_logs")
      .select("cost_usd")
      .gte("created_at", dayStart.toISOString()),
    supabase
      .from("generation_logs")
      .select("cost_usd")
      .gte("created_at", monthStart.toISOString()),
  ]);

  const sum = (rows: { cost_usd?: number }[] | null) =>
    (rows ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const wl = waitlist.count ?? 0;
  const conf = confirmed.count ?? 0;

  const stats: [string, string][] = [
    ["Waitlist", wl.toLocaleString()],
    ["Confirmed", `${conf.toLocaleString()} (${wl ? Math.round((100 * conf) / wl) : 0}%)`],
    ["Invite codes", (codes.count ?? 0).toLocaleString()],
    ["Redeemed", (redemptions.count ?? 0).toLocaleString()],
    ["Active beta users", (activeUsers.count ?? 0).toLocaleString()],
    ["Plans generated", (plans.count ?? 0).toLocaleString()],
    ["AI spend today", `$${sum(spendTodayRows.data).toFixed(2)}`],
    ["AI spend this month", `$${sum(spendMonthRows.data).toFixed(2)}`],
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label} className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="h-24 animate-pulse rounded-lg border bg-muted/40" />}>
      <Totals />
    </Suspense>
  );
}
