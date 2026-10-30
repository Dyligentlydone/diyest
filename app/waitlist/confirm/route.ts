import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import {
  referralLink,
  sendEmail,
  waitlistConfirmedEmail,
} from "@/lib/email";
import { requestOrigin } from "@/lib/env";
import {
  computePosition,
  unsubscribeToken,
  type WaitlistEntry,
} from "@/lib/waitlist";

/** GET — double opt-in: confirm the email, then bounce to the thanks page. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const base = requestOrigin(request);
  if (!token || !isSupabaseConfigured())
    return NextResponse.redirect(`${base}/?confirm=invalid`);

  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("waitlist")
    .select("id, email, seq, referral_code, referral_count, referred_by, confirmed_at")
    .eq("confirm_token", token)
    .maybeSingle();
  if (!row) return NextResponse.redirect(`${base}/?confirm=invalid`);

  if (!row.confirmed_at) {
    await supabase
      .from("waitlist")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", row.id);
    // bump the referrer — only confirmed signups count
    if (row.referred_by) {
      const { data: referrer } = await supabase
        .from("waitlist")
        .select("id, referral_count")
        .eq("referral_code", row.referred_by)
        .maybeSingle();
      if (referrer)
        await supabase
          .from("waitlist")
          .update({ referral_count: (referrer.referral_count ?? 0) + 1 })
          .eq("id", referrer.id);
    }

    // post-confirm email: position + personal referral link (+ unsubscribe)
    const me = { ...row, confirmed_at: new Date().toISOString() };
    const { data: confirmedRows } = await supabase
      .from("waitlist")
      .select("seq, referral_count, confirmed_at")
      .not("confirmed_at", "is", null)
      .limit(10000);
    const pos = computePosition(
      me as WaitlistEntry,
      [...(confirmedRows ?? []), me] as WaitlistEntry[]
    );
    const mail = waitlistConfirmedEmail({
      position: pos,
      referralCount: row.referral_count ?? 0,
      referralUrl: referralLink(row.referral_code),
      unsubUrl: `${base}/waitlist/unsubscribe?e=${encodeURIComponent(row.email)}&t=${unsubscribeToken(row.email)}`,
    });
    void sendEmail({ to: row.email, ...mail });
  }

  return NextResponse.redirect(
    `${base}/waitlist/thanks?c=${encodeURIComponent(row.referral_code)}`
  );
}
