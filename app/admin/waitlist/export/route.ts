import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { isAdminEmail } from "@/lib/site-mode";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { computePosition, type WaitlistEntry } from "@/lib/waitlist";

/** GET — CSV export of the waitlist (owner only). */
export async function GET(_request: NextRequest) {
  if (!isSupabaseConfigured()) return new NextResponse("Not configured", { status: 503 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email))
    return new NextResponse("Not found", { status: 404 });

  const svc = createServiceClient();
  const { data } = await svc
    .from("waitlist")
    .select(
      "email, seq, referral_code, referral_count, referred_by, confirmed_at, invited_at, build_answer, heard_from, utm_source, utm_medium, utm_campaign, invite_code, marketing_opt_in, created_at"
    )
    .order("seq")
    .limit(50000);
  const rows = (data ?? []) as (WaitlistEntry & Record<string, unknown>)[];
  const confirmed = rows.filter((r) => r.confirmed_at);

  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head =
    "position,email,confirmed_at,invited_at,referral_code,referrals,referred_by,build_answer,heard_from,utm_source,utm_medium,utm_campaign,invite_code,marketing_opt_in,created_at";
  const body = rows
    .map((r) =>
      [
        computePosition(r, confirmed as WaitlistEntry[]) || "",
        r.email, r.confirmed_at, r.invited_at, r.referral_code, r.referral_count,
        r.referred_by, r.build_answer, r.heard_from, r.utm_source, r.utm_medium,
        r.utm_campaign, r.invite_code, r.marketing_opt_in, r.created_at,
      ]
        .map(esc)
        .join(",")
    )
    .join("\n");

  return new NextResponse(`${head}\n${body}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="diyest-waitlist.csv"`,
    },
  });
}
