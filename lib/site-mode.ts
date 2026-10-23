/**
 * Site mode gate (invite-only beta vs public launch).
 *
 * SITE_MODE=invite_only (default) — every app route and API endpoint
 * requires a signed-in user with an active invite grant on their profile.
 * Public pages (homepage, /p/*, /gallery, legal) stay open.
 *
 * SITE_MODE=public — the M6 launch behavior; everything behaves as before.
 *
 * Enforcement lives here and in the API routes themselves — never only in
 * middleware or UI.
 */
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type SiteMode = "invite_only" | "public";

export function siteMode(): SiteMode {
  return process.env.SITE_MODE === "public" ? "public" : "invite_only";
}

export function isInviteOnly(): boolean {
  return siteMode() === "invite_only";
}

/** Page/API path prefixes that stay public in invite_only mode. */
const PUBLIC_PREFIXES = [
  "/",
  "/gallery",
  "/p/",
  "/login",
  "/auth/",
  "/invite/",
  "/waitlist",
  "/legal/",
  "/api/waitlist",
  "/api/auth",
  "/api/feedback", // public shared-page feedback is allowed pre-login
];

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some(
    (p) => p !== "/" && (pathname === p || pathname.startsWith(p))
  );
}

/** Comma-separated owner emails with admin access — always allowed in. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(email.toLowerCase());
}

export interface BetaAccess {
  /** signed-in user email */
  email: string | null;
  /** has a currently-active invite grant (or is an admin) */
  active: boolean;
  /** grant level, e.g. 'pro' during beta */
  level: "basic" | "intermediate" | "pro";
  isAdmin: boolean;
}

/**
 * Resolve the signed-in user's beta access. Returns null when signed out.
 * Admin emails always count as active pro.
 */
export async function betaAccessFor(userId: string): Promise<BetaAccess | null> {
  return accessRow(userId);
}

async function accessRow(userId: string): Promise<BetaAccess | null> {
  const supabase = createServiceClient();
  const { data: user } = await supabase.auth.admin.getUserById(userId);
  const email = user.user?.email ?? null;
  if (isAdminEmail(email))
    return { email, active: true, level: "pro", isAdmin: true };

  const { data: p } = await supabase
    .from("profiles")
    .select("beta_access_level, beta_access_until")
    .eq("id", userId)
    .maybeSingle();
  const until = p?.beta_access_until ? Date.parse(p.beta_access_until) : null;
  const active = !!p?.beta_access_level && (until == null || until > Date.now());
  return {
    email,
    active,
    level: active ? (p.beta_access_level as BetaAccess["level"]) : "basic",
    isAdmin: false,
  };
}

/**
 * API-route gate. In invite_only mode returns the access info or a Response
 * to send back immediately (401 signed-out, 403 no active invite).
 * In public mode only the signed-in requirement applies.
 */
export async function requireApiAccess(): Promise<
  { userId: string; access: BetaAccess } | { response: NextResponse }
> {
  if (!isSupabaseConfigured())
    return { response: NextResponse.json({ error: "Not configured" }, { status: 503 }) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      response: NextResponse.json({ error: "Sign in to continue" }, { status: 401 }),
    };

  if (!isInviteOnly()) {
    return {
      userId: user.id,
      access: { email: user.email ?? null, active: true, level: "basic", isAdmin: false },
    };
  }

  const access = await betaAccessFor(user.id);
  if (!access?.active)
    return {
      response: NextResponse.json(
        {
          error: "invite_required",
          message:
            "diyest is in invite-only beta. Join the waitlist or enter an invite code.",
        },
        { status: 403 }
      ),
    };
  return { userId: user.id, access };
}

/**
 * Invite check for routes that already verify sign-in themselves.
 * Returns a 403 response to send back, or null when access is fine.
 */
export async function denyIfNoInvite(userId: string): Promise<NextResponse | null> {
  if (!isInviteOnly()) return null;
  const access = await betaAccessFor(userId);
  if (!access?.active)
    return NextResponse.json(
      {
        error: "invite_required",
        message:
          "diyest is in invite-only beta. Join the waitlist or enter an invite code.",
      },
      { status: 403 }
    );
  return null;
}

/** Redirect to the waitlist when a signed-in user lacks an active invite. */
export async function denyPageIfNoInvite(userId: string): Promise<void> {
  if (!isInviteOnly()) return;
  const access = await betaAccessFor(userId);
  if (!access?.active) redirect("/?invite=required#waitlist");
}

/**
 * Page-route gate. Redirects signed-out visitors to /login (with next= back)
 * and signed-in uninvited users to the homepage waitlist. Returns the access
 * info for the page. Public mode only requires sign-in.
 */
export async function requirePageAccess(
  currentPath: string
): Promise<{ userId: string | null; access: BetaAccess | null }> {
  if (!isInviteOnly() || !isSupabaseConfigured())
    return { userId: null, access: null }; // public mode — pages allow anonymous
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  const access = await betaAccessFor(user.id);
  if (!access?.active) redirect("/?invite=required#waitlist");
  return { userId: user.id, access };
}

/**
 * Owner-only admin gate — 404 keeps /admin invisible to everyone else.
 * Use inside Suspense children (it reads the session).
 */
export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  if (!isSupabaseConfigured()) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) notFound();
  return { userId: user.id, email: user.email! };
}

/** Beta protective caps (config). Pro features, rate-limited during beta. */
export function betaCaps() {
  return {
    maxPlansPerDay: Number(process.env.BETA_MAX_PLANS_PER_DAY ?? "10") || 10,
    maxPlansPerMonth: Number(process.env.BETA_MAX_PLANS_PER_MONTH ?? "40") || 40,
  };
}

/** Pure check so it's unit-testable. */
export function betaCanGenerate(usedToday: number, usedMonth: number) {
  const caps = betaCaps();
  if (usedToday >= caps.maxPlansPerDay)
    return { allowed: false as const, reason: "beta_daily_limit" as const };
  if (usedMonth >= caps.maxPlansPerMonth)
    return { allowed: false as const, reason: "beta_monthly_limit" as const };
  return { allowed: true as const, reason: null };
}
