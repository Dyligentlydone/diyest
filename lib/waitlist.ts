/**
 * Waitlist domain logic — pure functions for unit testing.
 * Position = rank among confirmed members by "effective order":
 * each member's signup seq minus REFERRAL_BOOST × confirmed referrals.
 */
import { randomBytes, createHash } from "crypto";

export const REFERRAL_BOOST = 5;

export interface WaitlistEntry {
  seq: number;
  referral_count: number;
  confirmed_at: string | null;
}

export function effectiveRank(seq: number, referralCount: number): number {
  return seq - REFERRAL_BOOST * referralCount;
}

/**
 * 1-based position in line. Only confirmed members count (you must confirm
 * before referrals or invites mean anything). `others` are the confirmed
 * members you're ranked against (including yourself is fine — the comparison
 * is strict less-than).
 */
export function computePosition(
  me: WaitlistEntry,
  others: WaitlistEntry[]
): number {
  if (!me.confirmed_at) return 0;
  const myRank = effectiveRank(me.seq, me.referral_count);
  return (
    1 +
    others.filter(
      (o) => o.confirmed_at && effectiveRank(o.seq, o.referral_count) < myRank
    ).length
  );
}

/** Human-shareable referral code, e.g. "K3X9P2QM" — unambiguous alphabet. */
export function makeReferralCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** One-time confirm token for double opt-in. */
export function makeConfirmToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Deterministic unsubscribe token for an email (no raw email in the link). */
export function unsubscribeToken(email: string): string {
  const secret = process.env.UNSUBSCRIBE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dev";
  return createHash("sha256").update(`${secret}:${email.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}
