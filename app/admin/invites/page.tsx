import { Suspense } from "react";
import { requireAdmin } from "@/lib/site-mode";
import { createServiceClient } from "@/lib/supabase/server";
import { createCodes, deactivateCode } from "./actions";

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
}

async function InviteAdmin() {
  await requireAdmin();
  const supabase = createServiceClient();

  const results = await Promise.all([
    supabase.from("invite_codes").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("invite_redemptions").select("code"),
    supabase.from("profiles").select("id, invite_code").not("invite_code", "is", null),
    supabase.from("usage_events").select("user_id").eq("kind", "plan_generate"),
    supabase.from("projects").select("user_id").eq("is_public", true),
    supabase.from("waitlist").select("invite_code").not("invite_code", "is", null),
  ]).catch(() => null);
  if (!results) {
    return (
      <p className="rounded-md border p-4 text-sm text-muted-foreground">
        Couldn&apos;t load invite data — refresh to retry.
      </p>
    );
  }
  const [
    { data: codes },
    { data: redemptions },
    { data: betaProfiles },
    { data: planEvents },
    { data: shared },
    { data: attributed },
  ] = results;

  const userCode = new Map((betaProfiles ?? []).map((p) => [p.id, p.invite_code as string]));
  const perCode = (rows: { code?: string | null; user_id?: string | null; invite_code?: string | null }[] | null, key: "code" | "user_id" | "invite_code") => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const c = key === "user_id" ? userCode.get(r.user_id ?? "") : r[key];
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  };
  const signups = perCode(redemptions, "code");
  const plansGen = perCode(planEvents, "user_id");
  const sharedPlans = perCode(shared, "user_id");
  const waitlistAttr = perCode(attributed, "invite_code");

  return (
    <>
      <form action={createCodes} className="rounded-lg border p-4">
        <h2 className="font-semibold">Create codes</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Single code</span>
            <input name="code" placeholder="MAKERJANE" className="mt-0.5 h-9 w-full rounded border bg-transparent px-2 font-mono uppercase" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Batch prefix</span>
            <input name="prefix" placeholder="BETA" className="mt-0.5 h-9 w-full rounded border bg-transparent px-2 font-mono uppercase" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Batch count</span>
            <input name="count" type="number" min={0} max={500} placeholder="0" className="mt-0.5 h-9 w-full rounded border bg-transparent px-2" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Type</span>
            <select name="kind" defaultValue="invite" className="mt-0.5 h-9 w-full rounded border bg-background px-2">
              <option value="invite">Invite (personal)</option>
              <option value="promo">Promo (creator&rsquo;s shared code)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Label (creator)</span>
            <input name="label" placeholder="e.g. Maker Jane" className="mt-0.5 h-9 w-full rounded border bg-transparent px-2" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Linked invite (promo only)</span>
            <input name="linkedCode" placeholder="e.g. AIMEE" className="mt-0.5 h-9 w-full rounded border bg-transparent px-2 font-mono uppercase" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Max uses (blank = 1 invite / 500 promo)</span>
            <input name="maxUses" type="number" min={1} placeholder="auto" className="mt-0.5 h-9 w-full rounded border bg-transparent px-2" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Code expires</span>
            <select name="expiresPreset" defaultValue="never" className="mt-0.5 h-9 w-full rounded border bg-background px-2">
              <option value="never">Never</option>
              <option value="6mo">6 months</option>
              <option value="1y">1 year</option>
              <option value="custom">Custom date →</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Custom expiry (only if &ldquo;Custom date&rdquo;)</span>
            <input name="expiresAt" type="date" className="mt-0.5 h-9 w-full rounded border bg-transparent px-2" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Grant level</span>
            <select name="grantLevel" defaultValue="pro" className="mt-0.5 h-9 w-full rounded border bg-background px-2">
              <option value="pro">pro</option>
              <option value="intermediate">intermediate</option>
              <option value="basic">basic</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Grant days (blank = no expiry)</span>
            <input name="grantDays" type="number" min={1} placeholder="60" className="mt-0.5 h-9 w-full rounded border bg-transparent px-2" />
          </label>
        </div>
        <button className="mt-3 h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Create</button>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">Label</th>
              <th className="py-2 pr-3 font-medium">Uses</th>
              <th className="py-2 pr-3 font-medium">Expires</th>
              <th className="py-2 pr-3 font-medium">Grant</th>
              <th className="py-2 pr-3 font-medium">Signups</th>
              <th className="py-2 pr-3 font-medium">Plans</th>
              <th className="py-2 pr-3 font-medium">Shared</th>
              <th className="py-2 pr-3 font-medium">Waitlist</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(codes ?? []).map((c) => (
              <tr key={c.id} className={`border-b ${c.is_active ? "" : "opacity-50"}`}>
                <td className="py-2 pr-3 font-mono text-xs">
                  {c.code}
                  {c.kind === "promo" && (
                    <span className="ml-1.5 rounded bg-purple-100 px-1 py-0.5 text-[10px] font-semibold text-purple-800">
                      PROMO
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {c.label ?? "—"}
                  {c.linked_code && (
                    <span className="block text-[10px] text-muted-foreground">
                      → {c.linked_code}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">{c.uses}/{c.max_uses}</td>
                <td className="py-2 pr-3">{fmt(c.expires_at)}</td>
                <td className="py-2 pr-3">{c.grant_access_level}{c.grant_days ? ` ${c.grant_days}d` : ""}</td>
                <td className="py-2 pr-3 tabular-nums">{signups.get(c.code) ?? 0}</td>
                <td className="py-2 pr-3 tabular-nums">{plansGen.get(c.code) ?? 0}</td>
                <td className="py-2 pr-3 tabular-nums">{sharedPlans.get(c.code) ?? 0}</td>
                <td className="py-2 pr-3 tabular-nums">{waitlistAttr.get(c.code) ?? 0}</td>
                <td className="py-2 text-right">
                  <form action={deactivateCode}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value={String(c.is_active)} />
                    <button className="text-xs text-muted-foreground underline">
                      {c.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!codes?.length && <p className="py-8 text-center text-sm text-muted-foreground">No codes yet.</p>}
      </div>
    </>
  );
}

export default function AdminInvitesPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg border bg-muted/40" />}>
      <InviteAdmin />
    </Suspense>
  );
}
