# Model Routing Plan — diyest

Goal: every plan a user sees has zero blocker-level issues, appears quickly, and costs ≤ $0.25 on average (including review, repairs and escalation).

## 1. Constraints and targets

| Target | Value |
|---|---|
| Blockers in final plans shown to users | 0 (top priority) |
| Something useful on screen | < 20 s |
| Full plan on screen | < 90 s |
| Final, carpenter-checked plan | < 3 min |
| Average cost per plan (all calls) | ≤ $0.25 |
| Hard cost cap for any single plan | $0.60 (stop escalating beyond this) |

The $0.25 is an average: a hard chair can cost $0.40 if most shelves cost $0.10.

## 2. Models and prices (OpenAI pricing page, checked Oct 22, 2026; per 1M tokens, Standard tier)

| Model | Input | Cached input | Output | Role here |
|---|---|---|---|---|
| `gpt-6-luna` | $0.10 | $0.01 | $0.50 | Default worker: plan stages, targeted repairs, chat, ideas |
| `gpt-6.1-sol` | $2.00 | $0.10 | $10.00 | Reviewer, escalation, safety-critical diagnosis |
| `gpt-6-astra` | $10.00 | $1.00 | $50.00 | Not used (5× Sol, over budget) |

- Flex/Batch tier is listed at roughly half of Standard. Flex may be slower; see experiment E.
- Note: GPT-6 has no mid-tier model; GPT-5.6 Terra ($2 / $12) costs more than 6.1 Sol, so don't use it.
- Prices live in `lib/ai/pricing.ts`, not hard-coded in reports. Re-check the pricing page before launch.
- Count reasoning tokens as output tokens when computing cost.

## 3. Recommended architecture: two-stage Luna + Sol review + escalation on failure

1. **STAGE 1 (Luna, effort medium)** — Input: photos + user inputs. Output: title, summary, overall dims, parts + placements + profiles, assumptions, clarifying questions. NO joints, steps or tools yet. → stream title/summary/parts to the UI as they arrive.
2. **CODE: geometry validation + contact detection** — Validate geometry (§6 rules). Compute the exact list of touching solid pairs (part ids + copy indexes + contact face/area). If geometry fails → targeted geometry repair (Luna, returns only parts) → validate again (max 1). → render the BLUEPRINT as soon as geometry passes.
3. **STAGE 2 (Luna, effort medium)** — Input: stage-1 plan + the computed contact list + user skill/tools. Output: joints (one per listed contact, no extras), steps, tools, consumables, safety, estimates. → hardware list derived in code from joints. Show the full plan with "Master carpenter check in progress…".
4. **REVIEW (Sol, effort medium)** — always runs. Input: full plan JSON (no images). Output: review.v1 schema.
5. **If blockers/majors: ONE merged targeted repair (Luna)** — returns only the sections that need changing (joints/steps, or parts if geometry). Validate in code. Re-review only if a blocker was fixed.
6. **ESCALATION (only if blockers remain after step 5)** — re-run stages 1 + 2 on Sol, validate, review once more. Stop if the plan's running cost would exceed the $0.60 hard cap. If blockers still remain → friendly "This one's tricky" state, log for prompt improvement.

Why this route:
- The two biggest failure types (undeclared joints, bookkeeping) are removed by code supplying the facts (contact list, hardware totals) instead of the model inferring them.
- Luna does almost all generation at ~1¢ per plan; Sol is spent where judgment matters (review) and only rescues the few plans Luna can't fix.
- The user sees the blueprint after stage 1 and the full plan after stage 2, while the review runs in the background.

## 4. Model per task

| Task | Model | Notes |
|---|---|---|
| Plan stage 1 (geometry) | Luna | escalate to Sol per §3 step 6 |
| Plan stage 2 (joints/steps) | Luna | escalate to Sol per §3 step 6 |
| Targeted repairs | Luna | |
| Buildability review | Sol | see experiment D for cheaper options |
| Escalation regenerate | Sol | rare; capped |
| Fix-it diagnosis (electrical/gas/structural risk) | Sol | safety-critical, single call |
| Project ideas (space/leftovers) | Luna | |
| "I'm stuck" chat (incl. progress photos) | Luna | escalate a message to Sol only if the user flags the answer as wrong |
| Modify plan | Luna, then the same validate → review → repair path | |

Env vars: `AI_MODEL_PLAN`, `AI_MODEL_REVIEW`, `AI_MODEL_ESCALATE`, `AI_MODEL_CHAT`, `AI_MODEL_IDEAS`, `AI_MODEL_DIAGNOSE`, `AI_REASONING_EFFORT_*`, `PLAN_COST_CAP_USD=0.60`.

## 5. Expected cost per plan (estimate — measure it)

| Piece | Tokens (rough) | Cost |
|---|---|---|
| Luna stage 1 + stage 2 | ~30k | ~$0.01 |
| Sol review | ~12k in / ~6k out | ~$0.08 |
| Luna targeted repair (when needed) | ~15k | ~$0.005 |
| **Typical plan (no escalation)** | | **~$0.09–0.10** |
| Sol escalation (stages 1+2) + re-review | ~45k + ~18k | ~$0.30–0.37 |
| **Average with 20% escalation rate** | | **~$0.17** |
| **Worst case (escalated plan, all-in)** | | **~$0.47** (under the $0.60 cap) |

Use prompt caching: keep the long, static system prompts first and identical across calls so they're billed at the cached rate (Sol cached input is 95% cheaper).

## 6. Experiments (same regression set: bench, birdhouse, chair, coffee-table, desk, step-stool, round-table, not-buildable)

- **C+B — Primary:** the full architecture in §3. Report escalation rate.
- **C-only:** §3 without escalation (steps 1–5). Shows how much the two-stage design fixes on its own.
- **A — Sol does all generation (small sample):** run on chair, desk and bench only. Report cost and quality. If average cost is clearly > $0.25, stop there.
- **D — Reviewer benchmark (cheap and important):** build a small "known-flaw" set of 4–6 plans with planted problems, starting with the v1.2 round-table plan (screws through cleats already against the top; screws into end grain of round legs; cleats glued across the grain of a solid top). Add a few more: a shelf with no support, a solid top glued to aprons, a step that needs a tool the user doesn't own, a missing anti-tip strap on a tall bookcase. Run each through Luna-as-reviewer and Sol-as-reviewer, 3 runs each. Report the catch rate per flaw. If Luna catches ≥ 90% of blockers, consider Luna review + Sol only for load-bearing plans.
- **E — Flex tier for the review:** run the Sol review on Flex for the regression set. Report latency and cost. Adopt only if final-plan time stays < 3 min.
- **Effort:** keep `medium` for generation (the earlier A/B showed low gives thinner joinery). Try `low` for stage 1 only, since geometry is more mechanical; keep it if geometry pass rate holds.

## 7. Decision rules (what to ship)

Ship the cheapest setup that meets all of:
- 0 blockers in the final plan on ≥ 7/8 regression plans (and the not-buildable case refused).
- Average cost ≤ $0.25 per plan; no single plan above the $0.60 cap.
- Median time to something useful < 20 s, full plan < 90 s, final checked plan < 3 min.

If nothing meets all three, prioritize in that order (quality > cost > speed) and say what the trade-off is.

## 8. Guardrails (build these regardless of which setup wins)

- Per-call cost logging in `generation_logs`: model, tier, input/cached/output/reasoning tokens, $ cost, latency, stage, plan id.
- Per-plan cost cap (`PLAN_COST_CAP_USD`): stop escalating and show the friendly state when reached.
- Daily spend alert: if total spend in a day exceeds a threshold (`DAILY_SPEND_ALERT_USD`, default $5), log loudly and email the owner.
- Timeouts and fallbacks: if a call exceeds 120 s or errors, retry once; if Sol is unavailable, fall back to Luna review and mark the plan "review pending".
- No silent downgrade: the UI must never claim "carpenter checked" unless the Sol (or chosen) review actually ran and passed.
- Keep prompt versions (`plan.v1.4` stages, `review.v1`) logged on every plan so eval results stay comparable.

## 9. Report format

One table per experiment, one row per plan:

`Plan | Useful on screen (s) | Full plan (s) | Final (s) | Calls (by model) | Tokens | Cost ($) | Repairs | Escalated? | Final verdict | Blockers left`

Then: averages per experiment, the reviewer benchmark catch-rate table (experiment D), the recommended setup per §7 with one paragraph explaining why, and anything that surprised you.

## 10. Out of scope for now

- Real-user photo set (added later; rerun the winning setup on it before launch).
- Other providers (Anthropic, Google). Keep `lib/ai/` provider-agnostic so we can test them later.
- Astra. Revisit only if quality targets can't be met otherwise.
