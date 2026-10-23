# diyest — Product & Build Brief, version 2

**This brief replaces the original brief (`devin-prompt-diy-app.md`) for all remaining work.** It folds in every decision made since Milestone 1. Where this brief and the original disagree, **this brief wins**. Where this brief and the existing code disagree on something already built, ask me before changing working code.

Save this file in the repo as `docs/BRIEF-v2.md`. Related docs: `docs/MODEL-ROUTING-PLAN.md` (AI models, pipeline, cost) and the prompt files in `lib/ai/prompts/`.

Work milestone by milestone (§11). At the end of each milestone: stop, summarize what you built, list anything you were unsure about, and tell me how to test it.

---

## 1. Product

**diyest** turns "I want to make that" into a complete, buildable plan. A user shows it a photo (or describes an idea, a broken thing, an empty space, or leftover materials) and gets:

- an overview with difficulty, time and cost, shown before they commit
- an accurate **blueprint** drawn by our code (classic blue-and-white style)
- a cut list with board layouts, a shopping list, and a tool list
- step-by-step instructions with safety notes, checked by an AI "master carpenter"
- help while building: an "I'm stuck" chat, progress-photo checks, a glossary

Audience: hobbyist and beginner-to-intermediate DIYers, mostly woodworking and home projects. Most users arrive on a phone, often with a photo from Pinterest, Instagram, a store website, or their own camera. **Mobile-first, photo-first.**

Product name in code: one config constant (`APP_NAME = "diyest"`), so it can be changed in one place.

---

## 2. Status

| # | Milestone | Status |
|---|---|---|
| 1 | Foundation: Next.js, Supabase auth + DB, settings | ✅ Done |
| 2 | Core generation: photo → plan, validation, repair, review, progressive UI | ✅ Done |
| 2.5 | Model routing: two-stage generation, Luna + Sol routing, cost guardrails (`MODEL-ROUTING-PLAN.md`) | ⏳ In progress |
| 3 | Visuals & shopping: blueprint polish, cut list, shopping list, units, tools, glossary | Next |
| 4 | More ways in & build help: Fix it / My space / Leftovers, quick modifiers, "I'm stuck" chat, build mode | Upcoming |
| 5 | Keeping users: projects, journal, PDF + blueprint sheets, sharing, public gallery, 3D preview | Upcoming |
| 6 | Money & launch: limits, credits, Stripe, affiliates, landing, legal, analytics, admin | Upcoming |
| 7 | After launch: native app wrapper, more providers, growth features (backlog) | Later |

---

## 3. Core principles (non-negotiable)

1. **The AI never draws and never does bookkeeping.** It returns structured data. Our code draws blueprints, computes cut layouts, totals hardware, prices the shopping list, converts units, rounds for display, and detects which parts touch.
2. **Everything visible comes from one plan object.** Blueprint, cut list, shopping list and steps always agree because they're computed from the same data.
3. **Millimeters internally.** Convert only for display (imperial as feet-inches with fractions to 1/16").
4. **Zero blockers shown to users.** Plans pass geometry validation and the master-carpenter review, or they get the friendly "This one's tricky" state. Never a long list of scary warnings. Never claim "carpenter checked" unless the review actually ran and passed.
5. **Fast first, perfect shortly after.** Something useful on screen in < 20 s, the full plan in < 90 s, the final checked plan in < 3 min.
6. **Cost-aware.** Average AI cost ≤ $0.25 per plan; hard cap $0.60 per plan; every call logged with its cost (see routing plan).
7. **Safety over completeness.** Anything people sit on, stand on, climb, sleep on, or hang overhead gets conservative defaults and a clear disclaimer. Electrical, gas, structural and pressurized-plumbing work is flagged with "turn off the supply / check local code / consider a licensed professional", and the app never instructs work on live circuits or gas lines.

---

## 4. AI pipeline (summary — details in `MODEL-ROUTING-PLAN.md`)

```
Stage 1 (Luna): photo survey (silhouette/components/hidden structure) + parts + placements
                                                  → stream title/overview; blueprint as soon as geometry passes
Code: geometry validation + contact detection      → exact list of touching part pairs
Stage 2 (Luna): joints + steps + tools + estimates  → full plan on screen, "Master carpenter check in progress…"
Review (Sol+Luna, review.v2): buildability + photo  → reviewers see the user's photos; a visible major mass
  fidelity check against the photos                   missing from the plan (return, pedestal, carcass) is a blocker
Targeted repair (Luna) if blockers/majors          → "Improved after carpenter review" badge
Escalation (Sol regenerate, Fast tier, 360s/call)   → only if blockers remain; an escalation error/timeout never
                                                       fails the run — falls back to the best plan so far and shows
                                                       the friendly "This one's tricky" state. An adopted escalated
                                                       plan keeps the primary plan's overall_dimensions_mm unless
                                                       the escalated geometry can't fit inside them (primary dims
                                                       were wrong). The escalated plan is gated by code validation
                                                       only (no second review pass — saves ~90s); it is marked
                                                       review-pending, never "carpenter checked".
```

- Prompts live in `lib/ai/prompts/` as versioned files (`plan.v1.6*`, `review.v2` via review.v1.ts), and every plan stores the prompt versions used.
- Clarifying questions: if the AI is missing a key fact (scale, material, load), it asks up to 3 short questions while still producing its best plan. The user can answer and regenerate, or continue.
- `NOT_BUILDABLE`: friendly refusal for things that can't be built at home (vehicles, appliance internals, non-project photos), with no review or repair calls wasted.
- **Plan caching and reuse:** hash the normalized request (image hashes + inputs + prompt versions + model names + reasoning effort / stage-1 effort override / REVIEW_MODE / service tiers). An identical request returns the cached plan instantly at no cost. On a deploy that changes any salted input, run `tsx --env-file-if-exists=.env.production.local scripts/clear-plan-cache.ts` to guarantee no stale hits. Public gallery plans can be cloned without generating anything.

---

## 5. Plan data model (current, v1.4)

All dimensions in mm. Stored as `projects.plan` (jsonb) and validated with Zod (`lib/plan/schema.ts`). Key pieces:

- **Overview:** title, summary, difficulty, est_hours, est_cost {low, high, currency}, overall_dimensions_mm, assumptions, clarifying_questions, safety_overview, load_bearing.
- **Parts:** id, name, material, stock (board / sheet / dowel / other), length/width/thickness, qty, **source** ("make" | "buy") + **buy_spec** for off-the-shelf parts, and geometry:
  - **Box placements** `{x, y, z, sx, sy, sz}` for flat parts, with an optional **profile** (rect, rounded_rect, circle, ellipse, or SVG path with holes) for curved and shaped outlines.
  - **Axis placements** `{from, to, roll_deg}` for legs, braces and dowels, with a **cross_section** (rect or round, optionally tapered) and **ends** ("square" | "level" for splayed legs that sit flat).
- **Joints:** one per contact between parts: part_a, part_b, count, type, fasteners (per joint), glue, drive_from, step, note.
- **Hardware:** **derived in code** from joints (grouped by name + size). Kits are listed once.
- **Consumables:** glue, sealant, finish, sandpaper. Separate from joints.
- **Tools:** name, required, alternative.
- **Steps:** n, title, text, parts_used (joint parts auto-added in code), tools_used, safety, tip, PPE.

Validation rules: see `lib/plan/validate.ts` (geometry, placements, profiles, axis lengths, bounds, overlaps via manifold-3d, nothing floating, every contact has a joint, joint steps consistent, bought parts have buy_spec, target dimensions ±5%, load-bearing minimums, tool inventory).

---

## 6. Feature catalog (everything we plan to build)

Status: ✅ built · M# = milestone where it's built.

### 6.1 Ways in
| Feature | What it does | Status |
|---|---|---|
| **Build this** | Photo(s) + optional description + target size → plan. Strongly encourage rough target dimensions ("about 120 cm wide"); explain that it makes the plan far more accurate. | ✅ |
| **Fix it** | Photo of something broken → diagnosis (likely cause, confidence, what to check, call-a-pro flag) → "Make repair plan". Safety-critical diagnosis runs on Sol. | M4 |
| **My space** | Photo of an empty corner/wall + measurements → 3–5 project ideas that fit → pick one → plan constrained to the space. | M4 |
| **Leftovers** | "I have 3 pallets and half a sheet of plywood" (+ optional photo) → 3–5 ideas that use them → plan; owned materials excluded from the shopping list. | M4 |
| **Describe it** | Text-only idea ("a bench for my entryway with shoe storage") → plan. | M4 (small) |

### 6.2 Make the plan fit the person
| Feature | What it does | Status |
|---|---|---|
| **Skill level** | Beginner gets pocket holes, screws, brackets and pre-made legs; advanced gets mortise-and-tenon, dovetails. | ✅ (input) |
| **Tools I own** | Saved tool inventory; "use my tools only" makes plans avoid other tools or give workarounds ("no table saw? have the store cut these boards"). | M3 |
| **Fit my space** | Quick action on any plan: enter the available width/depth/height → the plan rescales and re-checks. | M4 |
| **Budget mode** | Quick action "Make it cheaper" (hardwood → pine/plywood) or "Upgrade materials", with cost and look trade-offs explained. | M4 |
| **Style variants** | Quick action "Restyle": rustic / modern / Scandinavian / industrial / farmhouse, same build. | M4 |
| **Modify plan** | Free text ("make it 20% taller", "add a drawer"). Runs the full validate → review → repair path. | M4 |
| **Metric / imperial** | Toggle everywhere, remembered per user. | M3 |

### 6.3 Make it easier to build
| Feature | What it does | Status |
|---|---|---|
| **Blueprint sheet** | Front/top/side/isometric views, hidden lines, dimensions, angle marks, ⌀/R callouts, parts table with CUT column, title block, joint callouts, BUY marks. Curves, rounds, tapers and angled parts drawn exactly. | ✅ core; polish M3 |
| **Time & difficulty first** | Difficulty, time and cost range visible as early as possible (from stage 1/2), before the user scrolls into steps. | M3 |
| **Cut list + board layout** | Optimizer (pure code): how many boards/sheets to buy and where to cut each part, with kerf and least waste. | M3 |
| **Shopping list** | Grouped by store section (lumber, sheet goods, hardware & fasteners, bought parts, glue & finish); estimated line costs + total; "already have" checkboxes; copy/print; affiliate links later. | M3 (affiliates M6) |
| **Safety & PPE per step** | Safety note on every risky step; PPE icons (glasses, ear protection, mask, gloves); prominent disclaimer for load-bearing builds. | M3 |
| **Glossary** | Jargon (dado, kerf, countersink, pocket hole, rabbet…) underlined in steps; tap for a plain-English definition + small diagram where useful. Static glossary of ~100 terms in code; AI fills gaps. | M3 |
| **"I'm stuck" chat** | Per-step chat that knows the whole plan and the current step. | M4 |
| **Progress photo check** | In the chat: "here's my joint, does this look right?" → specific feedback. | M4 |
| **Build mode** | One step at a time, full screen, big text, big next/back buttons, screen stays awake (Wake Lock API), step checkboxes saved. Garage-friendly. | M4 |
| **Full-size templates** | For curved/shaped parts, a 1:1 printable template tiled across Letter/A4 pages with alignment marks, to trace onto the board. | M5 |
| **Exploded view & part sheets** | Exploded isometric with dashed join lines; one detail drawing per part (shop drawing). | M5 |
| **3D preview** | Interactive three.js view built from our existing solids; rotate, zoom, explode animation. The "wow" feature. | M5 (optional) |

### 6.4 Keeping users around
| Feature | What it does | Status |
|---|---|---|
| **My projects** | Dashboard: thumbnail, title, status (planned / in progress / done), % of steps done. | ✅ basic; M5 polish |
| **Build journal** | Dated photo + note entries per project, shown as a timeline. | M5 |
| **PDF export** | Printable plan: overview, blueprint sheet(s), cut layouts, shopping list, tools, steps, templates. Looks good in black and white (print-friendly blueprint variant). | M5 |
| **Shareable project pages** | `/p/[slug]`, private by default; plan + journal photos; Open Graph image showing the blueprint; "Build this yourself" clones into the viewer's account (counts as their trial plan, uses a credit, or is included with Pro). | M5 |
| **Public gallery** | `/gallery`: browse public projects by category (tables, shelves, outdoor, kids, storage…). Each page is SEO-friendly ("how to build a farmhouse bench") and brings in free traffic. | M5 |
| **Feedback loop** | "Was this plan accurate?" thumbs on each plan and "Report a problem" on each step. Reports feed the prompt-improvement backlog and the eval set. | M5 |

### 6.5 App feel
| Feature | What it does | Status |
|---|---|---|
| **Progressive loading** | Streamed title/overview, then blueprint, then full plan, then the review badge. Friendly progress messages. | ✅ (extend in M2.5) |
| **Installable web app (PWA)** | Manifest + icons + "Add to Home Screen" prompt; camera-first upload (`capture` attribute on mobile). | M6 |
| **Native app wrapper** | Wrap the web app with Capacitor for the App Store / Play Store once the web app is proven. | M7 |

---

## 7. Pricing & monetization (M6)

**There is no free monthly tier.** Every person gets **one free trial plan**, tied to a verified email. After that, they pay per plan or subscribe. Feature access comes in three levels: **Basic** (the free trial), **Intermediate** (a paid single plan) and **Pro** (subscription).

| Level | Price | How you get it | Includes |
|---|---|---|---|
| **Basic** | free | **1 trial plan per person, ever** (verified email required) | Full plan on screen: overview, blueprint view, cut list, shopping list, tools, all steps **with all safety notes**. Saved to their account. No downloads, no Modify, no chat, no quick modifiers. |
| **Intermediate** | **$4.99** per plan, or **5 for $14.99** (credits never expire) | buy a single plan or a pack | Everything in Basic, plus for that plan: PDF + blueprint downloads, full-size templates, **3 modifications** (Modify / Fit my space / Make it cheaper / Restyle), **10 "I'm stuck" messages** incl. photo checks, build mode, journal. |
| **Pro** | **$9.99/month** or **$59/year** (push annual) | subscription | Everything, unlimited: plans (fair-use soft cap), modifications, chat + photo checks, downloads, templates, projects, journal. |

- **Safety is never paywalled.** Every level sees every safety note, PPE icon and disclaimer.
- The upgrade moment: after the trial plan, show what they'd get at Intermediate and Pro, with a one-tap purchase.
- Stripe Checkout for subscriptions **and one-time credit packs**; Customer Portal; webhooks keep `subscriptions` and the `plan_credits` ledger in sync. Each plan stores its access level (`basic` / `intermediate` / `pro`) so per-plan allowances (3 modifications, 10 chat messages) can be enforced.
- Pricing and allowances live in config so they can be tested and changed easily. Track conversion (trial → purchase, purchase → Pro) for price testing.
- **Affiliate links** on shopping-list items (Amazon Associates, Home Depot, etc.) earn even on trial users. Build the `affiliate_url` plumbing now; I'll sign up for the programs. Show a clear affiliate disclosure.
- All limits enforced server-side via `usage_events` and `plan_credits`, never only in the browser.

### 7.1 Free trial: email required, abuse-resistant

Goal: **every plan is tied to a verified email**, and one person can't farm free plans by refreshing, using incognito, or making new addresses. The existing anonymous flow (`sessionStorage` draft + `diyest_anon_gens` cookie) is **replaced** by this.

Flow:
1. The visitor uploads their photo and fills in the form (no account yet, so there's no friction before they've invested).
2. On "Create my plan", ask for their **email** and run a **Cloudflare Turnstile** check (free, invisible CAPTCHA; ask me before adding).
3. Send a magic link. **Generation starts as soon as the email is submitted and passes the checks**, so the plan is ready or nearly ready when they click the link, but **the plan is only revealed after the email is verified**. If the link isn't clicked within 24 h, delete the unrevealed plan.
4. The verified email becomes their account. The trial plan is saved to it.

Abuse controls (all server-side):
- **One trial per normalized email:** lowercase; for Gmail/Googlemail strip dots and `+tags` from the local part; for other providers strip `+tags`. Store a hash of the normalized email in a `trial_claims` table.
- **Block disposable email domains** (maintained blocklist in config).
- **One trial per device:** a long-lived, signed first-party device ID cookie plus a lightweight browser fingerprint hash; store with the trial claim. A second trial from the same device asks them to sign in or buy.
- **IP limits:** max 2 trial generations per IP per 24 h (configurable), and a stricter cap on unverified generations.
- **Turnstile** on every trial submission.
- Log every trial attempt (email hash, device hash, IP hash, outcome) for review in `/admin`; never store raw IPs longer than needed.
- Copy on refusal stays friendly: "Looks like you've already used your free plan. Sign in, or get a plan for $4.99."

Email consent: the trial email is used for the account and the plan. **Marketing emails need a separate, unticked opt-in checkbox.** Include an unsubscribe link in any marketing email.

---

## 8. Data & routes (additions to what exists)

New or changed tables (migrations, RLS on all):
- `plan_credits` (user_id, delta, reason, stripe_payment_id, created_at): credit ledger for single-plan purchases.
- `trial_claims` (email_hash, device_hash, ip_hash, user_id, status, created_at): one free trial per person (§7.1).
- `projects`: add `access_level` ("basic" | "intermediate" | "pro") plus counters for modifications and chat messages used.
- `plan_cache` (request_hash, plan, prompt_versions, created_at): reuse identical requests.
- `plan_feedback` (project_id, step_n nullable, rating, comment, created_at).
- `generation_logs`: add per-call model, tier, input/cached/output/reasoning tokens, cost_usd, stage.
- `projects`: add `category` (for the gallery) and `is_featured`.

New routes: `/gallery`, `/gallery/[category]`, `/p/[slug]` (exists or extend), `/pricing`, `/admin` (owner-only), `/legal/terms`, `/legal/privacy`, `/legal/ai-disclaimer`.

---

## 9. Quality, safety & UX requirements

- **Mobile-first**; the plan page must work propped on a garage shelf (large-text option, build mode).
- **Accessibility:** semantic HTML, keyboard navigation, alt text, contrast.
- **Disclaimers:** footer + plan pages: plans are AI-generated; verify measurements and structural safety; consult a professional for electrical, gas, plumbing or structural work. Load-bearing plans get a prominent notice.
- **Uploads:** strip EXIF/location data; compress client-side; reject non-project images gracefully.
- **Rate limits** on every AI endpoint per user and per IP.
- **Errors and empty states everywhere;** never show a stack trace.
- **Email:** before launch, replace Supabase's test email sender with a real provider (Resend recommended; free tier) for login links and receipts. Ask me before adding it.
- **Cost guardrails** (from the routing plan): per-call cost logging, per-plan cap, daily spend alert.

---

## 10. Testing & evaluation

- Keep the unit tests (schema, solids, validator, cut list optimizer, pricing/credits) and the mocked pipeline tests green.
- **Regression set** (current stand-in): bench, birdhouse, chair, coffee-table, desk, step-stool, round-table, not-buildable. Run after every AI-related change.
- **Reviewer benchmark:** known-flaw plans (starting with the v1.2 round table) to confirm the review catches blockers.
- **Real photo set:** I'll add 10+ real photos (Pinterest, store sites, my phone). Before choosing final models and before launch, rerun everything on that set. Keep `eval/images` out of any public repo.
- **Grow the eval set from failures:** every user-reported bad plan becomes an eval case (with the user's permission, or a similar photo).
- Playwright E2E: upload → email + verify → trial plan revealed → second trial refused (same email variant, same device) → buy a single plan → export PDF → upgrade to Pro.
- Unit tests for email normalization, disposable-domain blocking and trial-claim checks.

---

## 11. Remaining milestones (in order; stop after each for my review)

**M2.5 — Model routing** (in progress): follow `MODEL-ROUTING-PLAN.md`. Two-stage generation, contact list from code, Sol review, targeted repair, escalation, cost logging and caps, experiments and report.

**M3 — Visuals & shopping**
- Blueprint polish: joint callouts, BUY marks, long-title fix, part highlighting (tap a part → highlighted in blueprint, parts table, cut list and steps), PNG/SVG download.
- Cut list optimizer (1D boards, 2D sheets, kerf, editable stock sizes; bought parts excluded; shaped parts use bounding rectangles with the shape drawn inside; angled members show true end-cut angles).
- Shopping list grouped by store section, line costs + total, "already have", copy/print, `affiliate_url` plumbing.
- Units toggle everywhere; tool inventory + "use my tools only".
- Time/difficulty/cost shown first; safety/PPE per step; glossary.

**M4 — More ways in & build help**
- Fix it, My space, Leftovers, Describe it.
- Quick modifiers: Fit my space, Make it cheaper / Upgrade, Restyle, free-text Modify (all through validate → review → repair).
- "I'm stuck" chat + progress photo check.
- Build mode.

**M5 — Keeping users**
- Projects dashboard polish, build journal.
- PDF export with blueprint sheets (blue and print-friendly variants), exploded view, part sheets, full-size tiled templates, print-to-scale option.
- Share pages with OG images, public gallery with categories + SEO, "Build this yourself" clone, plan caching.
- Feedback buttons. Optional: 3D preview.

**M6 — Money & launch**
- Free trial with email gate + abuse controls (§7.1), access levels Basic / Intermediate / Pro with per-plan allowances, credits ledger, Stripe subscriptions + credit packs, pricing page, affiliate disclosure.
- Landing page (hero: photo → blueprint transformation; how it works; examples from the gallery; pricing; FAQ).
- PWA install + camera-first upload.
- Legal pages; real email provider; analytics funnel (upload → email → trial plan → purchase → Pro; ask me before adding a provider; a free tier like PostHog is fine).
- `/admin` (owner-only): generation logs, cost per day/plan, failure reasons, flagged plans, feedback.
- Final polish: rate limits, error/empty states, E2E tests.

**M7 — After launch (backlog, don't build yet)**
- Capacitor wrapper for App Store / Play Store.
- Test other AI providers through the provider-agnostic `lib/ai/`.
- Community features: comments, "I built this" photos on public plans.
- More project types beyond woodwork (simple metal, garden, home repair).

---

## 12. Working agreements

- Ask before adding any paid third-party service not listed here.
- Keep `README.md` (setup) and `DECISIONS.md` (choices + why) current.
- Small, descriptive commits. No secrets in code. AI calls server-side only.
- Pricing, model names and limits live in config, not scattered in code.
- If something here is ambiguous or conflicts with what's built, make a reasonable choice, note it in `DECISIONS.md`, and flag it in your milestone summary.

---

## 13. Owner tasks (for me, not Devin) — listed so you know what's coming

- Add real test photos to `eval/images/`.
- Confirm the production domain (diyest.app / diyest.com) and connect it in Vercel.
- Create the Stripe account and products; sign up for affiliate programs.
- Create a free Cloudflare account for Turnstile (anti-bot check on the free trial).
- Set up the email provider account when asked.
- Trademark search and social handles for "diyest".
- Show early plans to 5–10 DIYers (r/DIY, r/woodworking, local groups) for feedback.
