import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  normalizeEmail,
  isDisposableEmail,
  emailHash,
} from "@/lib/email";
import {
  computePosition,
  effectiveRank,
  REFERRAL_BOOST,
  type WaitlistEntry,
} from "@/lib/waitlist";
import { checkCode, type InviteCodeRow } from "@/lib/invite";
import { betaCanGenerate, isPublicPath, siteMode } from "@/lib/site-mode";

/* ---------- email normalization & disposable blocking ---------- */

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
  });
  it("gmail: strips dots and +tags", () => {
    expect(normalizeEmail("j.a.n.e+shop@gmail.com")).toBe("jane@gmail.com");
  });
  it("googlemail maps to gmail", () => {
    expect(normalizeEmail("jane+tag@googlemail.com")).toBe("jane@gmail.com");
  });
  it("other providers: strips +tags, keeps dots", () => {
    expect(normalizeEmail("j.a.n.e+tag@outlook.com")).toBe("j.a.n.e@outlook.com");
  });
  it("same person dedupes to one hash across gmail variants", () => {
    expect(emailHash("jane+work@gmail.com")).toBe(emailHash("j.a.n.e@googlemail.com"));
  });
});

describe("isDisposableEmail", () => {
  it("blocks known disposable domains", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@YOPMAIL.com")).toBe(true);
  });
  it("allows normal domains", () => {
    expect(isDisposableEmail("jane@gmail.com")).toBe(false);
    expect(isDisposableEmail("jane@company.co.uk")).toBe(false);
  });
});

/* ---------- waitlist position math ---------- */

const member = (seq: number, referrals = 0, confirmed = true): WaitlistEntry => ({
  seq,
  referral_count: referrals,
  confirmed_at: confirmed ? "2025-01-01T00:00:00Z" : null,
});

describe("waitlist position", () => {
  it("unconfirmed member has no position", () => {
    expect(computePosition(member(1, 0, false), [])).toBe(0);
  });
  it("position counts confirmed members ranked ahead", () => {
    const list = [member(1), member(2), member(3)];
    expect(computePosition(member(1), list)).toBe(1);
    expect(computePosition(member(2), list)).toBe(2);
    expect(computePosition(member(3), list)).toBe(3);
  });
  it("referral boost moves you up", () => {
    const me = member(10, 1); // rank 10 - 5 = 5
    const ahead = [1, 2, 3, 4].map((s) => member(s));
    expect(effectiveRank(10, 1)).toBe(10 - REFERRAL_BOOST);
    expect(computePosition(me, [...ahead, me])).toBe(5);
  });
  it("enough referrals can put a late signup first", () => {
    const me = member(50, 12); // rank -10
    const others = [member(1), member(2), member(3), me];
    expect(computePosition(me, others)).toBe(1);
  });
  it("unconfirmed members don't occupy a spot", () => {
    const me = member(3);
    const list = [member(1, 0, false), member(2), me];
    expect(computePosition(me, list)).toBe(2);
  });
});

/* ---------- invite code validation ---------- */

const code = (o: Partial<InviteCodeRow> = {}): InviteCodeRow => ({
  code: "MAKERJANE",
  is_active: true,
  uses: 0,
  max_uses: 1,
  expires_at: null,
  ...o,
});

describe("checkCode", () => {
  const now = Date.parse("2025-06-01T00:00:00Z");
  it("missing code → invalid", () => {
    expect(checkCode(null, now)).toEqual({ ok: false, error: "invalid" });
  });
  it("active, unused, unexpired → ok", () => {
    expect(checkCode(code(), now).ok).toBe(true);
  });
  it("inactive → inactive", () => {
    expect(checkCode(code({ is_active: false }), now)).toEqual({
      ok: false,
      error: "inactive",
    });
  });
  it("expired → expired", () => {
    expect(
      checkCode(code({ expires_at: "2025-05-01T00:00:00Z" }), now)
    ).toEqual({ ok: false, error: "expired" });
  });
  it("used up → used_up", () => {
    expect(checkCode(code({ uses: 1, max_uses: 1 }), now)).toEqual({
      ok: false,
      error: "used_up",
    });
    expect(checkCode(code({ uses: 5, max_uses: 5 }), now)).toEqual({
      ok: false,
      error: "used_up",
    });
  });
  it("multi-use codes keep working until the cap", () => {
    expect(checkCode(code({ uses: 4, max_uses: 5 }), now).ok).toBe(true);
  });
});

/* ---------- beta caps ---------- */

describe("betaCanGenerate", () => {
  it("under both caps → allowed", () => {
    expect(betaCanGenerate(0, 0)).toEqual({ allowed: true, reason: null });
    expect(betaCanGenerate(9, 39)).toEqual({ allowed: true, reason: null });
  });
  it("daily cap blocks first", () => {
    expect(betaCanGenerate(10, 5).reason).toBe("beta_daily_limit");
  });
  it("monthly cap blocks", () => {
    expect(betaCanGenerate(3, 40).reason).toBe("beta_monthly_limit");
  });
});

/* ---------- site mode + public path gating ---------- */

describe("siteMode / isPublicPath", () => {
  beforeEach(() => {
    delete process.env.SITE_MODE;
  });
  it("defaults to invite_only", () => {
    expect(siteMode()).toBe("invite_only");
  });
  it("public when SITE_MODE=public", () => {
    process.env.SITE_MODE = "public";
    expect(siteMode()).toBe("public");
  });
  it("public pages stay open", () => {
    for (const p of ["/", "/gallery", "/gallery/tables", "/p/abc123", "/login",
      "/invite/MAKERJANE", "/waitlist/thanks", "/legal/privacy", "/api/waitlist"])
      expect(isPublicPath(p), p).toBe(true);
  });
  it("app pages are gated", () => {
    for (const p of ["/new", "/projects", "/projects/x", "/plan/draft", "/settings", "/admin"])
      expect(isPublicPath(p), p).toBe(false);
  });
});

/* ---------- requireApiAccess (route enforcement) ---------- */

const mockAuth = { user: null as null | { id: string; email: string } };
const mockProfile = { beta_access_level: null as string | null, beta_access_until: null as string | null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockAuth.user } }) },
  }),
  createServiceClient: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: mockAuth.user ? { email: mockAuth.user.email } : null } }) } },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mockProfile }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: () => true, requireEnv: (n: string) => n }));

describe("requireApiAccess", () => {
  beforeEach(() => {
    delete process.env.SITE_MODE;
    delete process.env.ADMIN_EMAILS;
    mockAuth.user = null;
    mockProfile.beta_access_level = null;
    mockProfile.beta_access_until = null;
  });

  async function call() {
    const { requireApiAccess } = await import("@/lib/site-mode");
    return requireApiAccess();
  }

  it("signed out → 401", async () => {
    const r = await call();
    expect("response" in r && r.response.status).toBe(401);
  });
  it("signed in, no invite → 403 invite_required", async () => {
    mockAuth.user = { id: "u1", email: "a@b.c" };
    const r = await call();
    expect("response" in r && r.response.status).toBe(403);
  });
  it("signed in, expired invite → 403", async () => {
    mockAuth.user = { id: "u1", email: "a@b.c" };
    mockProfile.beta_access_level = "pro";
    mockProfile.beta_access_until = "2020-01-01T00:00:00Z";
    const r = await call();
    expect("response" in r && r.response.status).toBe(403);
  });
  it("signed in, active invite → allowed with level", async () => {
    mockAuth.user = { id: "u1", email: "a@b.c" };
    mockProfile.beta_access_level = "pro";
    const r = await call();
    expect("response" in r).toBe(false);
    if ("access" in r) {
      expect(r.access.active).toBe(true);
      expect(r.access.level).toBe("pro");
    }
  });
  it("admin email always gets in", async () => {
    process.env.ADMIN_EMAILS = "owner@diyest.app";
    mockAuth.user = { id: "u1", email: "owner@diyest.app" };
    const r = await call();
    expect("response" in r).toBe(false);
    if ("access" in r) expect(r.access.isAdmin).toBe(true);
  });
  it("public mode only requires sign-in", async () => {
    process.env.SITE_MODE = "public";
    mockAuth.user = { id: "u1", email: "a@b.c" };
    const r = await call();
    expect("response" in r).toBe(false);
  });
});
