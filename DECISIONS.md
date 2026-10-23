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

## Milestone 4 (modes, modifiers, chat, build mode)

- **Tool inventory is canonical**: `lib/tools.ts` holds a grouped checklist (measuring/hand/power/clamping/safety) + alias map. `canonicalTool()` maps AI-emitted names (e.g. "skill saw" → "circular saw") to canonical names; `normalizeTools()` dedupes and keeps unknowns as custom. Settings and the /new form render the checklist; custom tools go in a free-text field.
- **Shopping "already have"**: localStorage is the pre-login device cache via `useSyncExternalStore` (hydration-safe). Saved projects persist `projects.shopping_have`; the union of server+local marks is pushed up once per project view.
- **Entry modes** on /new: build / describe / fix / space / leftovers as tabs. fix → /api/diagnose (Sol, photo required) → shows diagnosis, refuses licensed-trade work, then generates a repair plan with the diagnosis in context. space/leftovers → /api/ideas (Luna) → pick an idea → generate with `chosenIdea` + `spaceConstraintsMm`/`materialsOwned`. Leftover materials are token-matched out of the shopping list's material sections.
- **Modifiers** (`/api/modify`, Luna): fit_space (dims), cheaper, upgrade, restyle (5 styles), custom text — all produce a new full plan via the same validate → dual-review → repair path; `changedSteps` reports which steps differ. Saved projects get the modified plan + `modifications_used` incremented.
- **"I'm stuck" chat** (`/api/chat`, Luna; Sol when the user flags "didn't help"): full plan JSON + current step + 8-turn history + optional progress photo. `safety_related` replies get a badge.
- **Build mode**: fullscreen stepper, step checkboxes persist to localStorage keyed by project+plan-hash, screen Wake Lock, per-step "I'm stuck" chat carrying step context.
- **Allowances** (`lib/limits.ts`): per-plan counters on projects (`access_level`, `modifications_used`, `chat_messages_used`). Basic: 0 mods / 3 chats; Intermediate: 3 mods / 10 chats; Pro: unlimited. M4 tracks + reports usage only — M6 enforces.

## Milestone 5 (cache, PDF, 3D, dashboard, journal, sharing, gallery, feedback)

- **Plan cache**: `plan_cache` table (migration 0006) — hash of mode+inputs; a hit replays `meta`/`partial`/`final` events from the cached plan instead of calling the model, logged as `plan_cache_hit`.
- **Blueprint extras**: `renderBlueprint` gains a `print` variant (dark lines on white). `lib/blueprint/explode.ts` — painter-sorted iso projection powering the static exploded view, dashboard thumbnails, OG images and the interactive `Preview3D` (drag-rotate + explode slider). `lib/blueprint/sheets.ts` — per-part shop drawings (orthographic box views / scaled profile path) and full-size printable templates for shaped parts, tiled across pages with mm rulers and registration marks.
- **PDF export** is `/projects/[id]/print` — a print-styled server page covering overview, blueprint, part sheets, cut list, shopping list, exploded view, steps and templates; users print to PDF from the browser.
- **Dashboard**: `/projects` cards show iso thumbnails, % done from `step_progress`, and a status badge/changer via `PATCH /api/projects/[id]`.
- **Journal**: `journal_entries` + `/api/projects/[id]/journal` + timeline UI with optional photos (Supabase storage `project-images`, signed URLs); also rendered on shared pages.
- **Sharing**: `is_public` + `slug` + `category`/`is_featured` → `/p/[slug]` public read-only plan page (journal included), OG image via `opengraph-image.tsx` iso render, "Build this yourself" → clone for signed-in users (`/api/projects/[id]/clone`) or login redirect. `/gallery` + `/gallery/[category]` index shared plans with SEO titles/descriptions.
- **Feedback**: `plan_feedback` table + `/api/feedback` — plan thumbs up/down and per-step "report an issue" into `category`/`note`.
- **Cache Components**: pages that read runtime data (params/cookies) wrap all of it inside `<Suspense>` children — `await params` at page top-level fails prerendering in this Next.js version.
