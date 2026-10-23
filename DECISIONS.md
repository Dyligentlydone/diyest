# Decisions

Log of architecture choices and anything ambiguous in the brief, newest first.

## 2026-10-22 — Milestone 1 (Foundation)

- **Project lives in `buildit/` subdirectory.** The workspace folder "DIY App" is
  not a valid npm package name; `create-next-app` refused it. The handoff zip and
  extracted files stay at the workspace root.
- **Next.js 16 conventions:** `middleware.ts` is renamed `proxy.ts` in Next 16 —
  used for Supabase session refresh and auth redirects on `/settings` and
  `/projects`. `cookies()`/`headers()`/`params`/`searchParams` are awaited.
- **Auth:** email magic link (`signInWithOtp`, PKCE → `/auth/callback`) plus a
  `/auth/confirm` route for non-PKCE email templates. Google OAuth via
  `signInWithOAuth`. Profile rows are auto-created by a Postgres trigger on
  `auth.users` insert, so sign-up needs no client round-trip.
- **Graceful degradation without Supabase:** `lib/env.isSupabaseConfigured()`
  guards the proxy, header, login, settings and projects pages so the app runs
  locally before credentials exist. Flag any objection.
- **`generation_logs.user_id`:** the brief's suggested schema had no user_id, but
  anonymous/pre-save generations still need attribution for rate limits and cost
  tracking. Added a nullable `user_id` column.
- **`subscriptions` table:** write access is service-role only (Stripe webhooks);
  RLS grants users read-only access to their own row.
- **Vercel deploy not performed** — needs the user's Vercel account. Everything is
  deploy-ready; `vercel` CLI or GitHub import will work once env vars are set
  (see README).
- **shadcn preset:** installed via the new `shadcn` CLI defaults (base-nova
  preset, neutral base color, CSS variables). Components live in
  `components/ui/`.
