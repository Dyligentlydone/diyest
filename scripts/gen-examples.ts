/**
 * Renders homepage example images from real generated plans:
 *   public/examples/<slug>-blueprint.png  — the blueprint sheet
 *   public/examples/<slug>-iso.png        — assembled 3D view
 * Run: npx tsx scripts/gen-examples.ts
 */
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import sharp from "sharp";
import { planSchema } from "../lib/plan/schema";
import { renderBlueprint } from "../lib/blueprint/render";
import { renderExplodedSvg } from "../lib/blueprint/explode";
import { bookcasePlan, tablePlan } from "../tests/fixtures";

const BP_VARS: Record<string, string> = {
  "--bp": "#0b4f9c",
  "--line": "#eaf3ff",
  "--grid": "rgba(255,255,255,0.08)",
  "--grid-major": "rgba(255,255,255,0.16)",
};

function resolveVars(svg: string): string {
  let out = svg;
  for (const [k, v] of Object.entries(BP_VARS))
    out = out.replaceAll(`var(${k})`, v);
  return out;
}

async function rasterize(svg: string, width: number): Promise<Buffer> {
  return sharp(Buffer.from(resolveVars(svg)), { density: 150 })
    .resize({ width })
    .png()
    .toBuffer();
}

function realPlan(path: string) {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    let plan: unknown = j.plan;
    if (!plan && j.response) {
      try {
        plan = (JSON.parse(j.response).plan ?? null) as unknown;
      } catch {
        /* not plan json */
      }
    }
    const parsed = planSchema.safeParse(plan);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function main() {
  mkdirSync("public/examples", { recursive: true });

  const sources: { slug: string; plan: unknown }[] = [
    { slug: "bookcase", plan: bookcasePlan },
    { slug: "table", plan: tablePlan },
    {
      slug: "side-table",
      plan: realPlan("test-results/run-manual-table-vision.json"),
    },
    {
      slug: "pine-bookcase",
      plan: realPlan("test-results/run-2026-10-23T01-42-36.json"),
    },
  ];

  for (const { slug, plan } of sources) {
    const parsed = planSchema.safeParse(plan);
    if (!parsed.success) {
      console.log(`skip ${slug}: plan doesn't parse`);
      continue;
    }
    const p = parsed.data;
    const bp = renderBlueprint(p, "metric");
    if (bp) {
      await writeFileSync(
        `public/examples/${slug}-blueprint.png`,
        await rasterize(bp, 1100)
      );
      console.log(`${slug}-blueprint.png`);
    }
    const iso = renderExplodedSvg(p, { factor: 0.06 });
    if (iso) {
      await writeFileSync(
        `public/examples/${slug}-iso.png`,
        await rasterize(iso, 700)
      );
      console.log(`${slug}-iso.png`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
