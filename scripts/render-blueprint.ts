/**
 * Render the fixture plans to SVG files for visual review:
 *   npx tsx scripts/render-blueprint.ts
 * Writes test-results/blueprint-{bookcase,table}.svg — open in a browser and
 * compare against the handoff's blueprint-sample*.png.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { renderBlueprint } from "../lib/blueprint/render";
import { bookcasePlan, tablePlan } from "../tests/fixtures";

mkdirSync("test-results", { recursive: true });
for (const [name, plan] of [
  ["bookcase", bookcasePlan],
  ["table", tablePlan],
] as const) {
  const file = `test-results/blueprint-${name}.svg`;
  writeFileSync(file, renderBlueprint(plan, "metric"));
  console.log(`wrote ${file}`);
}
