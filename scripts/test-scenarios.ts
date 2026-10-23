/**
 * Live scenario tests (plan.v1.3 + review.v1) — real OpenAI calls.
 *
 *   npx tsx --env-file=.env.local scripts/test-scenarios.ts
 *
 * Runs:
 *   1. table-v1.3  — round side table photo; expects leg plates + hanger bolts
 *                    (or aprons) and Z-clips/slotted fasteners instead of
 *                    end-grain screws glued across the grain.
 *   2. not-buildable — a request that is not a buildable DIY project.
 * Results are written to test-results/scenario-<name>-<ts>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePlan, type GenerateResult } from "../lib/ai/generate";
import { planSchema } from "../lib/plan/schema";
import type { PlanRequest } from "../lib/ai/prompts/plan.v1.4";

const RESULTS_DIR = "test-results";

const BASE: Omit<PlanRequest, "imageCount"> = {
  mode: "build",
  units: "metric",
  skillLevel: "intermediate",
  budget: "balanced",
  style: "match_photo",
  useMyToolsOnly: false,
  currency: "USD",
};

function summarize(name: string, result: GenerateResult) {
  const ok = result.ok;
  const out: Record<string, unknown> = {
    scenario: name,
    ok,
    ...(ok
      ? {
          title: result.plan.title,
          parts: result.plan.parts.length,
          boughtParts: result.plan.parts.filter((p) => p.source === "buy").map((p) => `${p.id} ${p.name}`),
          joints: result.plan.joints.length,
          jointTypes: [...new Set(result.plan.joints.map((j) => j.type))],
          hardware: result.plan.hardware,
          steps: result.plan.steps.length,
          schemaValid: planSchema.safeParse(result.plan).success,
          unverified: result.unverified,
          warnings: result.warnings,
          repairCount: result.repairCount,
          review: result.review,
          latencyMs: result.latencyMs,
          tokens: result.tokens,
          promptVersion: result.promptVersion,
          plan: result.plan,
        }
      : { kind: result.kind, ...("summary" in result ? { summary: result.summary } : { errors: result.errors }) }),
  };
  const file = join(RESULTS_DIR, `scenario-${name}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  return file;
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });

  // 1. round table rerun — the plan that used to be unreachable/end-grain
  console.log("→ table-v1.3 (round side table photo) …");
  const img = readFileSync("../handoff/blueprint-sample-table.png");
  const table = await generatePlan(
    { ...BASE, imageCount: 1, targetDimensionsMm: { width: 600, depth: 600, height: 550 } },
    [`data:image/png;base64,${img.toString("base64")}`],
    { targetDimensionsMm: { width: 600, depth: 600, height: 550 } }
  );
  const f1 = summarize("table-v13", table);
  console.log(`  ✓ ${f1}`);
  if (table.ok) {
    const text = JSON.stringify(table.plan).toLowerCase();
    const checks = {
      usesLegPlatesOrAprons: /leg.?plate|hanger.?bolt|apron/.test(text),
      usesMovementFasteners: /z.?clip|slot|figure.?8/.test(text),
      noEndGrainScrewJoinery: !/end.?grain/.test(
        JSON.stringify(table.plan.joints.map((j) => j.type))
      ),
    };
    console.log("  checks:", JSON.stringify(checks));
  } else console.log("  ✗", table.kind);

  // 2. NOT_BUILDABLE path
  console.log("→ not-buildable …");
  const nb = await generatePlan(
    { ...BASE, imageCount: 0, description: "Repair my motorcycle's carburetor and resync the throttle bodies." },
    []
  );
  const f2 = summarize("not-buildable", nb);
  console.log(`  ✓ ${f2}`);
  console.log(`  result: ${nb.ok ? "plan (unexpected)" : nb.kind}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
