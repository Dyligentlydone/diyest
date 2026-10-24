/**
 * Email: normalization + disposable-domain blocking (brief §7.1 rules reused
 * for the waitlist) plus the outbound mail layer. Resend is wired in only
 * when RESEND_API_KEY is set — until then sendEmail() logs and returns ok so
 * flows are testable end-to-end without a key.
 */
import { createHash } from "crypto";
import { adminEmails } from "./site-mode";

const GMAIL_LIKE = new Set(["gmail.com", "googlemail.com"]);

/** Maintained disposable-domain blocklist — extend freely. */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "sharklasers.com",
  "yopmail.com",
  "yopmail.fr",
  "trashmail.com",
  "trashmail.net",
  "getnada.com",
  "inboxbear.com",
  "dispostable.com",
  "maildrop.cc",
  "fakeinbox.com",
  "throwawaymail.com",
  "mintemail.com",
  "spamgourmet.com",
  "mailnesia.com",
  "tempinbox.com",
  "moakt.com",
  "emailondeck.com",
  "burnermail.io",
  "courriel.fr",
  "jetable.org",
  "spambox.us",
  "mytemp.email",
  "tempail.com",
  "mohmal.com",
  "emailtemporanea.com",
  "dropmail.me",
  "anonbox.net",
  "33mail.com",
  "tmail.ws",
  "tmpmail.org",
]);

/**
 * Normalize for dedupe: lowercase; gmail/googlemail strip dots and +tags
 * from the local part; all other providers strip +tags only.
 */
export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_LIKE.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

/** SHA-256 of the normalized email — we index/dedupe on the hash, keep the raw for sending. */
export function emailHash(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

// ---------- sending (Resend when RESEND_API_KEY is set; stub otherwise) ----------

export interface SendResult {
  ok: boolean;
  /** "stub" when no provider key is configured */
  via: "resend" | "stub";
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "diyest <hello@diyest.com>";
  if (!key) {
    console.log(`[email:stub] to=${opts.to} subject="${opts.subject}"`);
    return { ok: true, via: "stub" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text }),
    });
    if (!res.ok) {
      console.error(`[email] resend ${res.status}: ${await res.text()}`);
      return { ok: false, via: "resend" };
    }
    return { ok: true, via: "resend" };
  } catch (e) {
    console.error("[email] send failed", e);
    return { ok: false, via: "resend" };
  }
}

/** Owner spend/system alerts — used by checkDailySpend and admin actions. */
export async function notifyOwner(subject: string, html: string): Promise<void> {
  const to = process.env.OWNER_EMAIL ?? adminEmailsFallback();
  if (!to) {
    console.error(`[notifyOwner:stub] ${subject}`);
    return;
  }
  await sendEmail({ to, subject: `[diyest] ${subject}`, html });
}

function adminEmailsFallback(): string | null {
  return adminEmails()[0] ?? null;
}

// ---------- templates ----------

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function waitlistConfirmEmail(opts: { confirmUrl: string; referralUrl: string }) {
  return {
    subject: "Confirm your spot on the diyest waitlist",
    html: `
      <div style="font-family:sans-serif;max-width:480px">
        <h2>You're on the list — one click left</h2>
        <p>Confirm your email to lock in your spot in line for diyest beta access.</p>
        <p><a href="${opts.confirmUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Confirm my email</a></p>
        <p style="color:#666;font-size:13px">After confirming you'll get a personal referral link — each friend who joins moves you up the line.</p>
        <p style="color:#999;font-size:12px">If you didn't request this, ignore it.</p>
      </div>`,
  };
}

export function waitlistConfirmedEmail(opts: {
  position: number;
  referralCount: number;
  referralUrl: string;
  unsubUrl: string;
}) {
  return {
    subject: `You're #${opts.position} on the diyest waitlist`,
    html: `
      <div style="font-family:sans-serif;max-width:480px">
        <h2>Confirmed — you're #${opts.position} in line</h2>
        <p>Your spot is locked. We'll email your beta invite as soon as a spot opens.</p>
        <p><strong>Move up faster:</strong> share your personal link — every friend who
        confirms bumps you up 5 spots. You've referred ${opts.referralCount} so far.</p>
        <p><a href="${opts.referralUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${opts.referralUrl}</a></p>
        <p style="color:#999;font-size:12px"><a href="${opts.unsubUrl}">Unsubscribe</a> from updates.</p>
      </div>`,
  };
}

export function inviteEmail(opts: { code: string; inviteUrl: string }) {
  return {
    subject: "Your diyest invite is here",
    html: `
      <div style="font-family:sans-serif;max-width:480px">
        <h2>You're in — welcome to the diyest beta</h2>
        <p>Your invite code: <strong style="font-size:18px;letter-spacing:1px">${opts.code}</strong></p>
        <p><a href="${opts.inviteUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Claim my invite</a></p>
        <p style="color:#666;font-size:13px">One click signs you in and unlocks Pro features free during the beta.</p>
      </div>`,
  };
}

/** Admin broadcast to waitlist subscribers — plain-text body, unsub footer. */
export function broadcastEmail(opts: {
  subject: string;
  body: string;
  unsubUrl: string;
}) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = opts.body
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return {
    subject: opts.subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px">
        ${paras}
        <p style="color:#999;font-size:12px"><a href="${opts.unsubUrl}">Unsubscribe</a> from updates.</p>
      </div>`,
    text: `${opts.body}\n\nUnsubscribe: ${opts.unsubUrl}`,
  };
}

export function referralLink(code: string): string {
  return `${appUrl()}/?ref=${encodeURIComponent(code)}#waitlist`;
}

export function inviteLink(code: string): string {
  return `${appUrl()}/invite/${encodeURIComponent(code)}`;
}
