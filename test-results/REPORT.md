# Test results — diyest

Run date: 2026-10-23 · Model: `gpt-6-luna` (plan + review) · Prompt: `plan.v1.3` + `review.v1` · App: Next.js 16.4.2 dev server on `http://localhost:3003`

> **Update — plan.v1.3 + buildability review (see §6–§8):** the schema now has explicit
> `joints`, per-part `source` (`make`/`buy`) + `buy_spec`; a second model pass reviews
> buildability after geometry validation, sends blocker/major issues through one more
> repair, and surfaces survivors as `unverified` (minors as tips). Earlier sections
> cover the original plan.v1.2 runs; §3 numbers are pre-review latencies/tokens.

## 1. Static checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS — 0 errors |
| `npm run lint` | PASS — 0 errors, 0 warnings |
| `npm run build` | PASS — 14 routes; `/projects/[id]` partial-prerender, all pages static-shell + streamed dynamic content |

## 2. Unit tests (vitest)

**25/25 pass** across 3 files (~450 ms):

- `tests/schema.test.ts` (5) — plan-schema parsing, nullable optional fields, OpenAI strict-mode compatibility (`strict: true`, all objects strict-clean)
- `tests/solids.test.ts` (5) — solid construction from box/axis placements, profile extrusion, exact intersection volumes via manifold-3d WASM
- `tests/validate.test.ts` (15) — every §6 rule: dimension sanity, `parts_used` refs, placement counts, box-dim ±1 mm, path-in-box, axis length/cross-section, aggregate bounds ±2 mm, unexplained-overlap detection, nothing-floats, splayed-leg end cuts, target ±5%, load-bearing minimums, tool inventory

## 3. Live generation runs (`POST /api/generate`)

Three real model calls against `gpt-6-luna`. Raw responses preserved as JSON in this folder.

| Run | Input | HTTP | Latency | Tokens | Repaired | Unverified issues |
|---|---|---|---|---|---|---|
| `run-manual-bookcase-text.json` | text only — "freestanding pine bookcase, 3 shelves, butt joints" | 200 | 48.7 s | 8,553 | no | none |
| `run-manual-table-vision.json` | image — `blueprint-sample-table.png` + "round side table" | 200 | 58.5 s | 10,789 | no | none |
| `run-2026-10-23T01-42-36.json` | text only — E2E script (same bookcase request) | 200 | 62.6 s | 10,026 | no | none |

### Run detail — E2E bookcase (`run-2026-10-23T01-42-36.json`)

- **Plan:** "Freestanding Pine Bookcase", 800×300×1800 mm (exact match to requested dims)
- **5 parts / 11 placements:** side panels (18 mm pine board), top+bottom, shelves, shelf stiffening rails, 6 mm plywood back — each with `material`, `stock`, `cross_section`, `ends`, `profile`
- **9 steps, 8 tools, 5 hardware items, 1 finish**
- `est_cost` $100–180 USD, `est_hours` 7, `difficulty` beginner, `load_bearing` true
- `safety_overview` populated; 6 assumptions recorded

### Run detail — vision table (`run-manual-table-vision.json`)

- **Plan:** "Round Solid-Pine Side Table", 600×600×600 mm
- **3 parts / 9 placements:** round tabletop (circle profile), **tapered splayed legs ×4** (axis placements), leg mounting cleats ×4 — exercises the hardest geometry paths
- 10 steps, 10 tools; all validator checks pass including splayed-leg level-cut rule

## 4. E2E assertions (`scripts/e2e.ts`)

11/11 PASS — page smoke (GET /, /new, /plan/draft), POST 200, anonymous-usage cookie incremented (`diyest_anon_gens=1`), `ok: true`, plan re-parses against `planSchema`, each overall dimension within ±5% of target, zero unverified validation issues.

Reproduce: `npx tsx scripts/e2e.ts` (add `--image <path>` to exercise the vision path).

## 5. Known gaps / not yet tested

- ~~NOT_BUILDABLE path~~ — verified live, see §7.
- ~~Repair pass~~ — covered deterministically by `tests/generate.test.ts` (mocked OpenAI), plus real review-driven repairs in §6/§8.
- **`generation_logs` / usage persistence** — Supabase vars absent from `.env.local` during these runs, so writes were skipped (anonymous cookie path exercised instead).
- **`materials` array** — earlier flag resolved: no such field exists in the schema; materials live on `parts[].material`/`stock` plus top-level `hardware`/`finishes`, all populated correctly.

## 6. Round-table rerun under plan.v1.3 + review.v1 (`scenario-table-v13-*.json`)

The live complaint: leg screws unreachable, end-grain screws, cleats glued across the grain. Same input photo (`handoff/blueprint-sample-table.png`), new pipeline:

- **Result:** ok, "Round Side Table" — 3 parts, **2 repair passes**, ~235 s, ~61.9k tokens
- **Joints:** `leg_plate_hanger_bolt` ×4 legs + `slotted_screw` cleat + `pocket_screw` — leg plates and hanger bolts carry the load instead of end-grain screws; slotted holes let the solid top move ✅
- **Bought parts:** tabletop + legs are `source: "buy"` with `buy_spec` (pre-made round top, tapered legs w/ hanger bolts) — shown in the shopping card, excluded from the cut list ✅
- **Residual unverified:** hardware qty mismatch on the leg-plate kit (model wrote `qty_per_joint: 4` instead of 1 → declared 16 vs listed 4). The validator caught it and it surfaces in the UNVERIFIED banner — exactly the intended behavior, though the repair pass didn't clear it.

## 7. NOT_BUILDABLE (`scenario-not-buildable-*.json`)

Request: "repair my motorcycle's carburetor…" → `ok: false, kind: "not_buildable"` with a sensible summary (vehicle repair ≠ furniture, safety reasoning included). No repair/review calls wasted — single generation call.

## 8. Forced-repair pipeline tests (`tests/generate.test.ts`, mocked OpenAI — deterministic)

| Scenario | Calls | Outcome |
|---|---|---|
| First plan fails geometry (bogus overall height) | gen → repair → review | ok, `repairCount: 1`, unverified `[]` |
| Review returns blocker | gen → review(fail) → repair → re-review(pass) | ok, `repairCount: 1` |
| Surviving blocker + minor | gen → review(fail) → repair → re-review(fail) | ok, blocker → `unverified`, minor → warnings tip |
| NOT_BUILDABLE title | gen only | `kind: "not_buildable"`, 1 call |
| Repair still fails validation | gen → repair | ok, errors surfaced in `unverified` |

## 9. Eval batch — 10 real photos (`eval/results/`)

Real furniture photos (Openverse/CC, see `eval/images/SOURCES.md`) through the full v1.3 pipeline (generate → validate → review → repair). B/M/m = blocker/major/minor review issues.

| Photo | Plan | Verdict | B/M/m | Repairs | Unverified | Parts (buy) | Latency | Tokens |
|---|---|---|---|---|---|---|---|---|
| bench | Rustic Outdoor Slatted Bench | pass | 0/0/1 | 1 | 0 | 7 (0) | 218 s | 50,152 |
| birdhouse | Large Woodpecker Nest Box, lift-open lid | —¹ | — | 2 | 8 | 10 (1) | 380 s | 83,148 |
| bookshelf | Slim Coffee Table with Lower Shelf | pass | 0/0/0 | 1 | 0 | 6 (0) | 219 s | 45,805 |
| chair | Painted Vintage-Style Side Chair | —¹ | — | 2 | 6 | 7 (0) | 412 s | 83,997 |
| coffee-table | Walnut-Look Console Table | —¹ | — | 1 | 4 | 6 (0) | 249 s | 45,028 |
| desk | Classroom Desk-and-Chair Set | —¹ | — | 1 | 10 | 10 (0) | 280 s | 51,010 |
| nightstand | Vintage-Style Painted End Table | fix² | 0/1/1 | 1 | 1 | 4 (0) | 279 s | 58,084 |
| planter | Privacy Fence Panel | fix² | 0/1/1 | 2 | 1 | 3 (1) | 332 s | 76,264 |
| step-stool | Two-Step Wooden Footstool | —¹ | — | 1 | 1 | 6 (0) | 217 s | 48,064 |
| stool (texture photo) | — | not_buildable ✅ | — | 0 | — | — | — | — |

¹ Review skipped — geometry errors survived the repair pass, so issues go straight to `unverified`.
² `fix` verdict: repair applied, re-review ran; 1 residual issue surfaces in the UNVERIFIED banner.

**Totals:** 9/10 plans built, 1 correctly refused (the "stool" photo was a texture, not furniture). ~541k tokens, ~40 min model compute (~15 min wall at concurrency 4). Every run needed ≥1 repair — the v1.3 joint/hardware rules are stricter than v1.2.

**Recurring residual class (worth a prompt fix):** fastener bookkeeping — 12× "fastener used by joints missing from hardware list" + qty mismatches, plus undeclared joints between touching parts (legs↔shelf, seat↔stiles). The validators catch all of them; the single repair pass doesn't always clear them. Options: a second allowed repair, or tighten `plan.v1.3`'s fastener-total instructions.

## 10. Environment note on cost

Token totals are recorded per run (`tokens` field). Dollar cost isn't reported —
`gpt-6-luna` pricing isn't exposed via the API; multiply totals by your plan's rate.
