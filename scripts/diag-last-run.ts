/**
 * Diagnose a captured /api/generate NDJSON stream: runs code validation on the
 * emitted plan and replays the Sol photo-aware review to see which issues would
 * have counted as blockers.
 *   npx tsx --env-file-if-exists=.env.local scripts/diag-last-run.ts <stream.ndjson> <photo.jpg>
 */
import { readFileSync } from "fs";
import { validatePlan } from "../lib/plan/validate";
import { callReview } from "../lib/ai/generate";
import type { Plan } from "../lib/plan/schema";

async function main() {
  const [streamPath, imagePath] = process.argv.slice(2);
  if (!streamPath) {
    console.error("usage: diag-last-run.ts <stream.ndjson> [photo.jpg]");
    process.exit(1);
  }

  let plan: Plan | null = null;
  for (const line of readFileSync(streamPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "plan") plan = ev.plan as Plan;
    } catch {
      /* partial line while streaming */
    }
  }
  if (!plan) {
    console.error("no 'plan' event found in stream");
    process.exit(1);
  }

  console.log(
    "PLAN:",
    plan.title,
    "—",
    plan.parts.length,
    "parts, dims:",
    plan.overall_dimensions_mm
  );
  const v = await validatePlan(plan, {});
  console.log("\nVALIDATION errors:", v.errors.length ? v.errors : "(none)");
  console.log("VALIDATION warnings:", v.warnings.length ? v.warnings : "(none)");

  if (imagePath) {
    const b64 = readFileSync(imagePath).toString("base64");
    const dataUrl = `data:image/jpeg;base64,${b64}`;
    const req = {
      skillLevel: "beginner",
      toolsOwned: undefined,
      useMyToolsOnly: false,
      units: "metric",
      mode: "build",
      currency: "USD",
      budget: "balanced",
      style: "match_photo",
    } as Parameters<typeof callReview>[1];
    console.log("\nRunning Sol review with photo…");
    const review = await callReview(JSON.stringify(plan), req, undefined, [dataUrl]);
    console.log("REVIEW:", review.verdict, "by", review.model);
    for (const i of review.issues)
      console.log(`  - ${i.severity} ${i.category} | ${i.problem} -> ${i.fix}`);
  }
}

void main();
