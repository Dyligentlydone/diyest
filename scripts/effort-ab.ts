import { generatePlan } from "../lib/ai/generate";
import type { PlanRequest } from "../lib/ai/prompts/plan.v1.4";
import { readFileSync } from "node:fs";

async function main() {
  const img = `data:image/png;base64,${readFileSync("../handoff/blueprint-sample-table.png").toString("base64")}`;
  const req: PlanRequest = {
    mode: "build", units: "metric", skillLevel: "intermediate", budget: "balanced",
    style: "match_photo", useMyToolsOnly: false, currency: "USD", imageCount: 1,
    targetDimensionsMm: { width: 600, depth: 600, height: 550 },
  };
  for (const effort of ["low", "medium"]) {
    process.env.AI_REASONING_EFFORT = effort;
    const t0 = Date.now();
    let first: number | null = null;
    const r = await generatePlan(req, [img], { targetDimensionsMm: req.targetDimensionsMm }, (ev) => {
      if (ev.type === "plan") first = Date.now() - t0;
    });
    if (r.ok)
      console.log(
        `effort=${effort}: t_plan=${((first ?? 0) / 1000).toFixed(0)}s total=${(r.latencyMs / 1000).toFixed(0)}s tokens=${r.tokens} repairs=${r.repairCount} verdict=${r.review?.verdict} unverified=${r.unverified.length} parts=${r.plan.parts.length} joints=${r.plan.joints.length}`
      );
    else console.log(`effort=${effort}: ${r.kind}`);
  }
}

main();
