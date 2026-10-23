/**
 * Regression check (v1.4 pipeline) — run after major changes.
 *
 *   npx tsx --env-file=.env.local scripts/regression.ts [--concurrency N]
 *
 * Runs the 6 eval photos + the round-table reference image + a
 * NOT_BUILDABLE request through generatePlan, and prints per-plan:
 * time to first plan, time to final, tokens, repairs, review verdict,
 * and remaining issues. Writes eval/results/regression-<ts>.json and
 * renders the table's blueprint to test-results/blueprint-table-v14.svg.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { generatePlan, type GenerateResult } from "../lib/ai/generate";
import { renderBlueprint } from "../lib/blueprint/render";
import { planSchema } from "../lib/plan/schema";
import type { PlanRequest } from "../lib/ai/prompts/plan.v1.4";

const IMAGES_DIR = "eval/images";
const RESULTS_DIR = "eval/results";
const TEST_RESULTS = "test-results";
const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const BASE: Omit<PlanRequest, "imageCount"> = {
  mode: "build",
  units: "metric",
  skillLevel: "intermediate",
  budget: "balanced",
  style: "match_photo",
  useMyToolsOnly: false,
  currency: "USD",
};

interface Row {
  name: string;
  title: string;
  ok: boolean;
  /** seconds until the first useful UI content (streamed meta/title) */
  tUsefulS: number | null;
  /** seconds until the blueprint-ready geometry was emitted */
  tPartialS: number | null;
  /** seconds until the full plan was emitted */
  tFirstPlanS: number | null;
  tFinalS: number;
  /** calls grouped as "3×luna,1×sol" */
  calls: string;
  tokens: number;
  costUsd: number;
  repairs: number;
  escalated: string | null;
  verdict: string;
  reviewModel: string;
  blockers: number;
  unverified: number;
  notes: string;
}

function callsSummary(result: { calls?: { model: string }[] }): string {
  const byModel = new Map<string, number>();
  for (const c of result.calls ?? [])
    byModel.set(c.model.replace(/^gpt-/, ""), (byModel.get(c.model.replace(/^gpt-/, "")) ?? 0) + 1);
  return [...byModel.entries()].map(([m, n]) => `${n}×${m}`).join(",");
}

async function runOne(name: string, dataUrl: string | null, req: PlanRequest): Promise<{ row: Row; result: GenerateResult }> {
  const t0 = Date.now();
  let tUseful: number | null = null;
  let tPartial: number | null = null;
  let tFirst: number | null = null;
  try {
    const result = await generatePlan(req, dataUrl ? [dataUrl] : [], {}, (ev) => {
      const t = Date.now() - t0;
      if (ev.type === "meta" && tUseful == null) tUseful = t;
      if (ev.type === "partial" && tPartial == null) tPartial = t;
      if (ev.type === "plan" && tFirst == null) tFirst = t;
    });
    const tFinal = (Date.now() - t0) / 1000;
    const row: Row = result.ok
      ? {
          name,
          title: result.plan.title,
          ok: true,
          tUsefulS: tUseful != null ? tUseful / 1000 : result.firstMetaMs != null ? result.firstMetaMs / 1000 : null,
          tPartialS: tPartial != null ? tPartial / 1000 : null,
          tFirstPlanS: tFirst != null ? tFirst / 1000 : result.firstPlanMs / 1000,
          tFinalS: tFinal,
          calls: callsSummary(result),
          tokens: result.tokens,
          costUsd: result.costUsd,
          repairs: result.repairCount,
          escalated: result.escalated,
          verdict: result.reviewPending ? `${result.review?.verdict ?? "?"}(pending)` : result.review?.verdict ?? "skipped",
          reviewModel: result.review?.model ?? "—",
          blockers: result.blockers.length,
          unverified: result.unverified.length,
          notes: planSchema.safeParse(result.plan).success ? "" : "SCHEMA FAIL",
        }
      : {
          name,
          title: "—",
          ok: false,
          tUsefulS: null, tPartialS: null, tFirstPlanS: null,
          tFinalS: tFinal,
          calls: "", tokens: 0, costUsd: 0, repairs: 0, escalated: null,
          verdict: result.kind, reviewModel: "—", blockers: 0, unverified: 0,
          notes: "summary" in result ? result.summary.slice(0, 80) : result.errors.slice(0, 2).join("; "),
        };
    return { row, result };
  } catch (e) {
    return {
      row: {
        name, title: "—", ok: false, tUsefulS: null, tPartialS: null, tFirstPlanS: null,
        tFinalS: (Date.now() - t0) / 1000,
        calls: "", tokens: 0, costUsd: 0, repairs: 0, escalated: null,
        verdict: "exception", reviewModel: "—", blockers: 0, unverified: 0,
        notes: (e as Error).message.slice(0, 120),
      },
      result: { ok: false, kind: "invalid", errors: [String(e)], raw: "" },
    };
  }
}

function dataUrlOf(path: string): string {
  const buf = readFileSync(path);
  const mime = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function main() {
  const concurrency = Math.max(
    1,
    parseInt(process.argv[process.argv.indexOf("--concurrency") + 1] || "3", 10) || 3
  );
  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(TEST_RESULTS, { recursive: true });

  const onlyIdx = process.argv.indexOf("--only");
  const only =
    onlyIdx >= 0 ? new Set(process.argv[onlyIdx + 1].split(",").map((s) => s.trim())) : null;

  const images = readdirSync(IMAGES_DIR)
    .filter((f) => EXTS.has(extname(f).toLowerCase()))
    .filter((f) => !only || only.has(basename(f, extname(f))));
  const jobs: Array<() => Promise<{ row: Row; result: GenerateResult }>> = [
    ...images.map((f) => () =>
      runOne(basename(f, extname(f)), dataUrlOf(join(IMAGES_DIR, f)), {
        ...BASE,
        imageCount: 1,
      })
    ),
    ...(!only || only.has("round-table")
      ? [
          () =>
            runOne("round-table", dataUrlOf("../handoff/blueprint-sample-table.png"), {
              ...BASE,
              imageCount: 1,
              targetDimensionsMm: { width: 600, depth: 600, height: 550 },
            }),
        ]
      : []),
    ...(!only || only.has("not-buildable")
      ? [
          () =>
            runOne("not-buildable", null, {
              ...BASE,
              imageCount: 0,
              description: "Repair my motorcycle's carburetor and resync the throttle bodies.",
            }),
        ]
      : []),
  ];

  console.log(`Running ${jobs.length} regression plans (concurrency ${concurrency})…\n`);
  const rows: Row[] = [];
  const results = new Map<string, GenerateResult>();
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      let job: (() => Promise<{ row: Row; result: GenerateResult }>) | undefined;
      while ((job = queue.shift())) {
        const { row, result } = await job();
        rows.push(row);
        results.set(row.name, result);
        console.log(`  done: ${row.name} (${row.tFinalS.toFixed(0)}s, ${row.verdict})`);
      }
    })
  );

  // blueprint render for the table
  const table = results.get("round-table");
  if (table?.ok) {
    const svg = renderBlueprint(table.plan, "metric");
    writeFileSync(join(TEST_RESULTS, "blueprint-table-v14.svg"), svg);
    console.log(`\nblueprint → ${TEST_RESULTS}/blueprint-table-v14.svg`);
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  console.log(
    "\nname          | useful | partial | plan | final | calls           | tokens | cost$ | rep | esc | verdict    | blk | title"
  );
  console.log("-".repeat(135));
  for (const r of rows)
    console.log(
      `${r.name.padEnd(13)} | ${(r.tUsefulS?.toFixed(0) ?? "—").padStart(6)} | ${(r.tPartialS?.toFixed(0) ?? "—").padStart(7)} | ${(r.tFirstPlanS?.toFixed(0) ?? "—").padStart(4)} | ${r.tFinalS.toFixed(0).padStart(5)} | ${r.calls.padEnd(15)} | ${String(r.tokens).padStart(6)} | ${("$" + r.costUsd.toFixed(3)).padStart(5)} | ${String(r.repairs).padStart(3)} | ${(r.escalated ? "Y" : "-").padStart(3)} | ${r.verdict.padEnd(10)} | ${String(r.blockers).padStart(3)} | ${r.title}`
    );

  const okRows = rows.filter((r) => r.ok);
  const avg = (f: (r: Row) => number | null) => {
    const xs = okRows.map(f).filter((x): x is number => x != null);
    return xs.length ? xs.reduce((a, b) => a + b) / xs.length : 0;
  };
  const med = (f: (r: Row) => number | null) => {
    const xs = okRows.map(f).filter((x): x is number => x != null).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  };
  console.log(
    `\nAVERAGES: useful ${avg((r) => r.tUsefulS).toFixed(0)}s · full plan ${avg((r) => r.tFirstPlanS).toFixed(0)}s · final ${avg((r) => r.tFinalS).toFixed(0)}s · cost $${avg((r) => r.costUsd).toFixed(3)} · tokens ${Math.round(avg((r) => r.tokens))}`
  );
  console.log(
    `MEDIANS:  useful ${med((r) => r.tUsefulS).toFixed(0)}s · full plan ${med((r) => r.tFirstPlanS).toFixed(0)}s · final ${med((r) => r.tFinalS).toFixed(0)}s`
  );
  console.log(`escalations: ${rows.filter((r) => r.escalated).length}/${okRows.length} · blocker-free finals: ${rows.filter((r) => r.ok && !r.blockers).length}/${okRows.length}`);

  const stamp = Date.now();
  writeFileSync(
    join(RESULTS_DIR, `regression-${stamp}.json`),
    JSON.stringify(
      {
        at: new Date(stamp).toISOString(),
        rows,
        results: Object.fromEntries(
          [...results.entries()].map(([k, v]) => [k, v.ok ? { plan: v.plan, review: v.review, unverified: v.unverified, blockers: v.blockers, warnings: v.warnings, tokens: v.tokens, costUsd: v.costUsd, calls: v.calls, latencyMs: v.latencyMs, firstPlanMs: v.firstPlanMs, firstMetaMs: v.firstMetaMs, repairCount: v.repairCount, improved: v.improved, escalated: v.escalated, reviewPending: v.reviewPending } : v])
        ),
      },
      null,
      2
    )
  );
  console.log(`\nresults → ${RESULTS_DIR}/regression-${stamp}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
