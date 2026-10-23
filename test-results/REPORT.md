# Test results — diyest

Run date: 2026-10-23 · Model: `gpt-6-luna` · Prompt: `plan.v1.2` · App: Next.js 16.4.2 dev server on `http://localhost:3003`

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

- **NOT_BUILDABLE path** untested live — needs a deliberately unbuildable prompt.
- **Repair pass** never triggered in these runs (first attempts were clean); logic is exercised only in unit tests.
- **`generation_logs` / usage persistence** — Supabase vars absent from `.env.local` during these runs, so writes were skipped (anonymous cookie path exercised instead).
- **`materials` array** — earlier flag resolved: no such field exists in the schema; materials live on `parts[].material`/`stock` plus top-level `hardware`/`finishes`, all populated correctly.
