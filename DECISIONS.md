# Decisions

Log of architecture choices and anything ambiguous in the brief, newest first.

## 2026-10-23 — Milestone 3 (plan UX)

- **Cut-list optimizer is pure code** (`lib/plan/cutlist.ts`): 1D first-fit
  decreasing for boards/dowels (tries every stock length, fewest pieces then
  least waste wins), 2D shelf packing for sheet goods, kerf-aware. Bought parts
  never appear; profiled parts pack as bounding rectangles with a "trace shape
  inside" note; `ends: "level"` members report their true end-cut angle.
- **Shopping list derives from the optimizer**, not the AI: lumber/sheet lines
  are the actual stock pieces to buy, hardware from derived totals, consumables
  and `source:"buy"` parts included. Rough per-line USD estimates are labeled
  "est."; `affiliateUrl` is plumbed but empty until M6.
- **"Already have" marks persist in localStorage** — no account needed; the
  shopping section is per-device (deliberate: works pre-login).
- **Tool inventory lives on `profiles.tools_owned`** (migration 0004). The
  `/new` form's "use my tools only" checkbox prefills it and sends
  `toolsOwned` + `useMyToolsOnly` to `/api/generate`; both the prompt and the
  validator enforce it.
- **PPE is per-step data** (`step.ppe` ⊆ glasses/hearing/mask/gloves) so step
  cards can show icon badges; also in `safety_overview` text.
- **Glossary is a static ~90-term dictionary** (`lib/glossary.ts`) —
  `GlossedText` underlines terms in step text and a collapsible glossary
  section renders them all. No AI call, no hover required (tap = mobile).
- **Part selection is single-source UI state** (`selId` in PlanView): parts
  table rows, cut-list rows and step part chips all toggle it; the blueprint
  re-renders with that part highlighted.
- **Stock labels are unit-aware**: imperial snaps to nominal inches only when
  within ~2mm (1220mm→48″, but 19mm→¾″), avoiding "48 1/16″ plywood" noise.

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
