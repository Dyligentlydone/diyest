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
  tFirstPlanS: number | null;
  tFinalS: number;
  tokens: number;
  repairs: number;
  improved: boolean;
  verdict: string;
  reviewModel: string;
  unverified: number;
  notes: string;
}

async function runOne(name: string, dataUrl: string | null, req: PlanRequest): Promise<{ row: Row; result: GenerateResult }> {
  const t0 = Date.now();
  let tFirst: number | null = null;
  try {
    const result = await generatePlan(req, dataUrl ? [dataUrl] : [], {}, (ev) => {
      if (ev.type === "plan" && tFirst == null) tFirst = Date.now() - t0;
    });
    const tFinal = (Date.now() - t0) / 1000;
    const row: Row = result.ok
      ? {
          name,
          title: result.plan.title,
          ok: true,
          tFirstPlanS: tFirst != null ? tFirst / 1000 : result.firstPlanMs / 1000,
          tFinalS: tFinal,
          tokens: result.tokens,
          repairs: result.repairCount,
          improved: result.improved,
          verdict: result.review?.verdict ?? "skipped",
          reviewModel: result.review?.model ?? "—",
          unverified: result.unverified.length,
          notes: planSchema.safeParse(result.plan).success ? "" : "SCHEMA FAIL",
        }
      : {
          name,
          title: "—",
          ok: false,
          tFirstPlanS: null,
          tFinalS: tFinal,
          tokens: 0,
          repairs: 0,
          improved: false,
          verdict: result.kind,
          reviewModel: "—",
          unverified: 0,
          notes: "summary" in result ? result.summary.slice(0, 80) : result.errors.slice(0, 2).join("; "),
        };
    return { row, result };
  } catch (e) {
    return {
      row: {
        name, title: "—", ok: false, tFirstPlanS: null,
        tFinalS: (Date.now() - t0) / 1000, tokens: 0, repairs: 0,
        improved: false, verdict: "exception", reviewModel: "—", unverified: 0,
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

  const images = readdirSync(IMAGES_DIR).filter((f) => EXTS.has(extname(f).toLowerCase()));
  const jobs: Array<() => Promise<{ row: Row; result: GenerateResult }>> = [
    ...images.map((f) => () =>
      runOne(basename(f, extname(f)), dataUrlOf(join(IMAGES_DIR, f)), {
        ...BASE,
        imageCount: 1,
      })
    ),
    () =>
      runOne("round-table", dataUrlOf("../handoff/blueprint-sample-table.png"), {
        ...BASE,
        imageCount: 1,
        targetDimensionsMm: { width: 600, depth: 600, height: 550 },
      }),
    () =>
      runOne("not-buildable", null, {
        ...BASE,
        imageCount: 0,
        description: "Repair my motorcycle's carburetor and resync the throttle bodies.",
      }),
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
  console.log("\nname          | t_plan | t_final | tokens | repairs | verdict       | unverified | title");
  console.log("-".repeat(105));
  for (const r of rows)
    console.log(
      `${r.name.padEnd(13)} | ${(r.tFirstPlanS?.toFixed(0) ?? "—").padStart(6)} | ${r.tFinalS.toFixed(0).padStart(7)} | ${String(r.tokens).padStart(6)} | ${String(r.repairs).padStart(7)} | ${r.verdict.padEnd(13)} | ${String(r.unverified).padStart(10)} | ${r.title}`
    );

  const stamp = Date.now();
  writeFileSync(
    join(RESULTS_DIR, `regression-${stamp}.json`),
    JSON.stringify(
      {
        at: new Date(stamp).toISOString(),
        rows,
        results: Object.fromEntries(
          [...results.entries()].map(([k, v]) => [k, v.ok ? { plan: v.plan, review: v.review, unverified: v.unverified, warnings: v.warnings, tokens: v.tokens, latencyMs: v.latencyMs, firstPlanMs: v.firstPlanMs, repairCount: v.repairCount, improved: v.improved } : v])
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
