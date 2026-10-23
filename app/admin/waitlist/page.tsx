import { Suspense } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/site-mode";
import { createServiceClient } from "@/lib/supabase/server";
import { computePosition, type WaitlistEntry } from "@/lib/waitlist";
import { inviteNextN } from "./actions";

type SP = Promise<{ q?: string; sort?: string; confirmed?: string }>;

async function WaitlistAdmin({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const { q = "", sort = "position", confirmed = "" } = await searchParams;
  const supabase = createServiceClient();

  let query = supabase
    .from("waitlist")
    .select(
      "id, email, seq, referral_code, referral_count, confirmed_at, invited_at, build_answer, heard_from, utm_source, utm_campaign, invite_code, created_at"
    )
    .order("seq")
    .limit(1000);
  if (q) query = query.ilike("email", `%${q}%`);
  if (confirmed === "1") query = query.not("confirmed_at", "is", null);
  const { data } = await query;
  const rows = (data ?? []) as (WaitlistEntry & {
    id: string; email: string; referral_code: string; invited_at: string | null;
    build_answer: string | null; heard_from: string | null;
    utm_source: string | null; utm_campaign: string | null; invite_code: string | null;
    created_at: string;
  })[];

  const confirmedRows = rows.filter((r) => r.confirmed_at);
  const withPos = rows.map((r) => ({
    ...r,
    pos: computePosition(r, confirmedRows as WaitlistEntry[]),
  }));
  if (sort === "position")
    withPos.sort((a, b) => (a.pos || 1e9) - (b.pos || 1e9));
  else withPos.sort((a, b) => b.seq - a.seq);

  const qs = new URLSearchParams({ q, sort, confirmed }).toString();

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <input name="q" defaultValue={q} placeholder="Search email…" className="h-9 rounded border bg-transparent px-2 text-sm" />
          <select name="sort" defaultValue={sort} className="h-9 rounded border bg-background px-2 text-sm">
            <option value="position">By position</option>
            <option value="date">By signup date</option>
          </select>
          <label className="flex h-9 items-center gap-1.5 text-sm">
            <input type="checkbox" name="confirmed" value="1" defaultChecked={confirmed === "1"} />
            Confirmed only
          </label>
          <button className="h-9 rounded border px-3 text-sm">Filter</button>
        </form>
        <div className="ml-auto flex items-end gap-2">
          <a href={`/admin/waitlist/export?${qs}`} className="h-9 rounded border px-3 text-sm leading-9">
            Export CSV
          </a>
          <form action={inviteNextN} className="flex items-end gap-2">
            <input name="n" type="number" min={1} max={500} defaultValue={10} className="h-9 w-20 rounded border bg-transparent px-2 text-sm" />
            <button className="h-9 rounded bg-primary px-3 text-sm font-medium text-primary-foreground">
              Invite next N
            </button>
          </form>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Refs</th>
              <th className="py-2 pr-3 font-medium">Wants to build</th>
              <th className="py-2 pr-3 font-medium">Source</th>
              <th className="py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {withPos.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2 pr-3 tabular-nums">{r.pos || "—"}</td>
                <td className="py-2 pr-3">{r.email}</td>
                <td className="py-2 pr-3 text-xs">
                  {r.invited_at ? (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">invited</span>
                  ) : r.confirmed_at ? (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">confirmed</span>
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5">pending</span>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">{r.referral_count}</td>
                <td className="max-w-[220px] truncate py-2 pr-3 text-xs">{r.build_answer ?? ""}</td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">
                  {[r.utm_source, r.utm_campaign, r.invite_code, r.heard_from]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!withPos.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">Nobody here yet.</p>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        <Link href="/admin/waitlist" className="underline">Clear filters</Link>
      </p>
    </>
  );
}

export default function AdminWaitlistPage(props: { searchParams: SP }) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg border bg-muted/40" />}>
      <WaitlistAdmin searchParams={props.searchParams} />
    </Suspense>
  );
}
