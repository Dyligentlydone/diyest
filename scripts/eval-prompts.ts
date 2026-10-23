/**
 * Prompt eval harness (brief §7).
 *
 *   npx tsx --env-file=.env.local scripts/eval-prompts.ts [--concurrency N] [--skip-existing]
 *
 * --concurrency N  run up to N images at once (default 1 — generation+review
 *                  is several model calls, so 3–4 roughly quarters wall time)
 * --skip-existing  skip images that already have a result in eval/results/
 *
 * Drop test photos in eval/images/ (jpg/png/webp). Optionally add a sidecar
 * <name>.json next to an image to override the request:
 *   { "description": "...", "targetDimensionsMm": {...}, "skillLevel": "...", ... }
 *
 * Each run writes eval/results/<image>-<ts>.json with the plan (or errors),
 * validation output, latency and token usage — diff these across prompt versions.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { generatePlan } from "../lib/ai/generate";
import { planSchema } from "../lib/plan/schema";
import type { PlanRequest } from "../lib/ai/prompts/plan.v1.3";

const IMAGES_DIR = "eval/images";
const RESULTS_DIR = "eval/results";
const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const DEFAULT_REQ: Omit<PlanRequest, "imageCount"> = {
  mode: "build",
  units: "metric",
  skillLevel: "intermediate",
  budget: "balanced",
  style: "match_photo",
  useMyToolsOnly: false,
  currency: "USD",
};

async function main() {
  if (!existsSync(IMAGES_DIR)) {
    console.error(`No ${IMAGES_DIR}/ — create it and add test photos.`);
    process.exit(1);
  }
  mkdirSync(RESULTS_DIR, { recursive: true });

  const concurrency = Math.max(
    1,
    parseInt(process.argv[process.argv.indexOf("--concurrency") + 1] || "1", 10) || 1
  );
  const skipExisting = process.argv.includes("--skip-existing");

  let images = readdirSync(IMAGES_DIR).filter((f) =>
    EXTS.has(extname(f).toLowerCase())
  );
  if (!images.length) {
    console.error(`${IMAGES_DIR}/ is empty — add test photos first.`);
    process.exit(1);
  }
  if (skipExisting) {
    const done = new Set(
      readdirSync(RESULTS_DIR).map((f) => f.split("-")[0])
    );
    images = images.filter((f) => !done.has(basename(f, extname(f))));
    if (!images.length) {
      console.log("All images already have results — nothing to do.");
      return;
    }
  }

  const runOne = async (file: string) => {
    const name = basename(file, extname(file));
    const sidecar = join(IMAGES_DIR, `${name}.json`);
    const overrides = existsSync(sidecar)
      ? (JSON.parse(readFileSync(sidecar, "utf8")) as Partial<PlanRequest>)
      : {};

    const buf = readFileSync(join(IMAGES_DIR, file));
    const mime = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

    const req = { ...DEFAULT_REQ, ...overrides, imageCount: 1 } as PlanRequest;
    console.log(`→ ${file} …`);
    try {
      const result = await generatePlan(req, [dataUrl], {
        targetDimensionsMm: req.targetDimensionsMm,
      });
      const out = {
        image: file,
        request: req,
        result: result.ok
          ? {
              title: result.plan.title,
              parts: result.plan.parts.length,
              steps: result.plan.steps.length,
              schemaValid: planSchema.safeParse(result.plan).success,
              unverified: result.unverified,
              warnings: result.warnings,
              repairCount: result.repairCount,
              review: result.review
                ? {
                    verdict: result.review.verdict,
                    issues: result.review.issues,
                    tokens: result.review.tokens,
                    latencyMs: result.review.latencyMs,
                  }
                : null,
              plan: result.plan,
            }
          : result,
        latencyMs: result.ok ? result.latencyMs : undefined,
        tokens: result.ok ? result.tokens : undefined,
        promptVersion: result.ok ? result.promptVersion : undefined,
      };
      const outFile = join(RESULTS_DIR, `${name}-${Date.now()}.json`);
      writeFileSync(outFile, JSON.stringify(out, null, 2));
      console.log(`  ✓ ${outFile}`);
    } catch (e) {
      console.error(`  ✗ ${file}: ${(e as Error).message}`);
      const outFile = join(RESULTS_DIR, `${name}-${Date.now()}-error.json`);
      writeFileSync(outFile, JSON.stringify({ image: file, error: String(e) }, null, 2));
    }
  };

  // tiny worker pool
  const queue = [...images];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    let f: string | undefined;
    while ((f = queue.shift())) await runOne(f);
  });
  await Promise.all(workers);
}

main();
