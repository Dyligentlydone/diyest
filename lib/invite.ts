/** Invite-code domain logic — validation is a pure function for tests. */
import { createServiceClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/email";

export interface InviteCodeRow {
  code: string;
  is_active: boolean;
  uses: number;
  max_uses: number;
  expires_at: string | null;
}

export type RedeemBlock = "invalid" | "inactive" | "expired" | "used_up";

export const REDEEM_BLOCK_COPY: Record<RedeemBlock, string> = {
  invalid: "That invite code doesn't exist — check for typos.",
  inactive: "That invite code has been turned off.",
  expired: "That invite code has expired.",
  used_up: "That invite code has already been fully used.",
};

/** Pure check — unit-testable. Codes are case-insensitive upstream. */
export function checkCode(
  code: InviteCodeRow | null,
  now: number = Date.now()
): { ok: true } | { ok: false; error: RedeemBlock } {
  if (!code) return { ok: false, error: "invalid" };
  if (!code.is_active) return { ok: false, error: "inactive" };
  if (code.expires_at && Date.parse(code.expires_at) <= now)
    return { ok: false, error: "expired" };
  if (code.uses >= code.max_uses) return { ok: false, error: "used_up" };
  return { ok: true };
}

export async function lookupCode(
  raw: string
): Promise<(InviteCodeRow & { id: string; kind: string; grant_access_level: string; grant_days: number | null }) | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("invite_codes")
    .select("id, code, kind, is_active, uses, max_uses, expires_at, grant_access_level, grant_days")
    .ilike("code", raw.trim()) // case-insensitive
    .maybeSingle();
  return data;
}

export type RedeemResult =
  | { ok: true; level: string }
  | { ok: false; error: RedeemBlock };

/**
 * Redeem a code for a signed-in user: validates, records the redemption,
 * bumps uses, and applies the grant to the profile (level + expiry).
 */
export async function redeemCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const supabase = createServiceClient();
  const code = await lookupCode(rawCode);
  const check = checkCode(code);
  if (!check.ok) return check;
  const c = code!;

  // already redeemed by this user? treat as success — idempotent revisits
  const { data: existing } = await supabase
    .from("invite_redemptions")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) {
    const { error } = await supabase.from("invite_redemptions").insert({
      code_id: c.id,
      user_id: userId,
      code: c.code,
    });
    if (error) return { ok: false, error: "used_up" }; // lost the uses race
    await supabase
      .from("invite_codes")
      .update({ uses: c.uses + 1 })
      .eq("id", c.id);
  }

  // Attribution: a creator's promo code is explicit last-touch and always wins.
  // For generic invites, keep the referral that first brought the user — their
  // waitlist row's invite_code — so waitlist→signup stays credited to the
  // creator who referred them.
  let attribution = c.code;
  if (c.kind !== "promo") {
    const { data: auth } = await supabase.auth.admin.getUserById(userId);
    const email = auth.user?.email ? normalizeEmail(auth.user.email) : null;
    if (email) {
      const { data: wl } = await supabase
        .from("waitlist")
        .select("invite_code")
        .eq("email", email)
        .maybeSingle();
      if (wl?.invite_code) attribution = wl.invite_code;
    }
  }

  const until =
    c.grant_days != null
      ? new Date(Date.now() + c.grant_days * 24 * 3600 * 1000).toISOString()
      : null;
  await supabase
    .from("profiles")
    .update({
      beta_access_level: c.grant_access_level,
      beta_access_until: until,
      invite_code: attribution,
    })
    .eq("id", userId);

  return { ok: true, level: c.grant_access_level };
}
