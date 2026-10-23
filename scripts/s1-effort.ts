/** Stage-1 effort A/B: low vs medium — geometry pass rate + latency. */
import { generatePlan } from "../lib/ai/generate";
import { readFileSync } from "node:fs";
import { validatePlan } from "../lib/plan/validate";

async function main() {
  const img = `data:image/png;base64,${readFileSync("../handoff/blueprint-sample-table.png").toString("base64")}`;
  const req: Parameters<typeof generatePlan>[0] = {
    mode: "build", units: "metric", skillLevel: "intermediate", budget: "balanced",
    style: "match_photo", useMyToolsOnly: false, currency: "USD", imageCount: 1,
    targetDimensionsMm: { width: 600, depth: 600, height: 550 },
  };
  for (const effort of ["low", "medium"]) {
    process.env.AI_REASONING_EFFORT_S1 = effort;
    const t0 = Date.now();
    let tPartial: number | null = null;
    const r = await generatePlan(req, [img], {}, (ev) => {
      if (ev.type === "partial") tPartial = Date.now() - t0;
    }, { stream: false });
    if (r.ok) {
      const v = await validatePlan(r.plan, {});
      console.log(
        `s1_effort=${effort}: partial=${((tPartial ?? 0) / 1000).toFixed(0)}s total=${(r.latencyMs / 1000).toFixed(0)}s cost=$${r.costUsd.toFixed(3)} blockers=${r.blockers.length} geomErrors=${v.issues.filter((i) => i.kind === "geometry").length} calls=${r.calls.map((c) => c.stage).join(",")}`
      );
    } else console.log(`s1_effort=${effort}: ${r.kind}`);
  }
}
main();
