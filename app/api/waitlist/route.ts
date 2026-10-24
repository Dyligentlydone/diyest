import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import {
  isDisposableEmail,
  normalizeEmail,
  emailHash,
  sendEmail,
  waitlistConfirmEmail,
  referralLink,
} from "@/lib/email";
import { makeConfirmToken, makeReferralCode } from "@/lib/waitlist";
import { verifyTurnstile } from "@/lib/turnstile";
import { GATE_COOKIE, GATE_WAITLIST } from "@/lib/site-mode";

/** Joining the waitlist unlocks browsing (not generating) — mark the browser. */
function withBrowseCookie(res: NextResponse): NextResponse {
  res.cookies.set(GATE_COOKIE, GATE_WAITLIST, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}

const schema = z.object({
  email: z.string().trim().max(320).email(),
  buildAnswer: z.string().max(500).optional(),
  heardFrom: z.string().max(200).optional(),
  marketingOptIn: z.boolean().default(false),
  turnstileToken: z.string().max(2048).optional(),
  ref: z.string().max(40).optional(),           // referrer's referral_code
  invite: z.string().max(60).optional(),        // influencer invite-code attribution
  utmSource: z.string().max(120).optional(),
  utmMedium: z.string().max(120).optional(),
  utmCampaign: z.string().max(120).optional(),
});

/** POST — join the waitlist. Idempotent per normalized email. */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  if (!(await verifyTurnstile(body.turnstileToken, ip)))
    return NextResponse.json({ error: "Bot check failed — try again." }, { status: 400 });

  const normalized = normalizeEmail(body.email);
  if (isDisposableEmail(normalized))
    return NextResponse.json(
      { error: "Please use a permanent email address." },
      { status: 400 }
    );

  const supabase = createServiceClient();
  const hash = emailHash(body.email);

  // dedupe: same normalized email → resend the confirmation instead of a new row
  const { data: existing } = await supabase
    .from("waitlist")
    .select("id, referral_code, confirmed_at, confirm_token")
    .eq("email_hash", hash)
    .maybeSingle();
  if (existing) {
    if (!existing.confirmed_at) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const confirmUrl = `${appUrl}/waitlist/confirm?token=${existing.confirm_token}`;
      const mail = waitlistConfirmEmail({
        confirmUrl,
        referralUrl: referralLink(existing.referral_code),
      });
      void sendEmail({ to: normalized, ...mail });
    }
    return withBrowseCookie(
      NextResponse.json({
        ok: true,
        referralCode: existing.referral_code,
        alreadyJoined: true,
        confirmed: !!existing.confirmed_at,
      })
    );
  }

  // referrer exists? (attribution — count bumps only after confirmation)
  let referredBy: string | null = null;
  if (body.ref) {
    const { data: ref } = await supabase
      .from("waitlist")
      .select("referral_code")
      .eq("referral_code", body.ref.trim().toUpperCase())
      .maybeSingle();
    referredBy = ref?.referral_code ?? null;
  }

  const referralCode = makeReferralCode();
  const confirmToken = makeConfirmToken();
  const { error } = await supabase.from("waitlist").insert({
    email: normalized,
    email_hash: hash,
    build_answer: body.buildAnswer?.trim() || null,
    heard_from: body.heardFrom?.trim() || null,
    referral_code: referralCode,
    referred_by: referredBy,
    invite_code: body.invite?.trim().toUpperCase() || null,
    utm_source: body.utmSource ?? null,
    utm_medium: body.utmMedium ?? null,
    utm_campaign: body.utmCampaign ?? null,
    marketing_opt_in: body.marketingOptIn,
    confirm_token: confirmToken,
  });
  if (error) {
    if (error.code === "23505") // unique race — treat as already joined
      return NextResponse.json({ ok: true, alreadyJoined: true, confirmed: false });
    console.error("[waitlist] insert failed", error);
    return NextResponse.json({ error: "Could not join the list — try again." }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const confirmUrl = `${appUrl}/waitlist/confirm?token=${confirmToken}`;
  const mail = waitlistConfirmEmail({ confirmUrl, referralUrl: referralLink(referralCode) });
  void sendEmail({ to: normalized, ...mail });

  return withBrowseCookie(
    NextResponse.json({ ok: true, referralCode, alreadyJoined: false, confirmed: false })
  );
}
