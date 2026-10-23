/**
 * Experiment D — reviewer benchmark (docs/MODEL-ROUTING-PLAN.md §6).
 *
 * Known-flaw plans with planted buildability problems; each reviewed 3× by
 * Luna and by Sol. A flaw counts as caught when a non-minor review issue
 * matches it. If Luna catches ≥90% of blockers, consider Luna review + Sol
 * only for load-bearing plans.
 *
 *   npx tsx --env-file=.env.local scripts/reviewer-bench.ts [--runs N]
 */
import { callReview } from "../lib/ai/generate";
import { writeFileSync } from "node:fs";
import type { PlanRequest } from "../lib/ai/prompts/plan.v1.4";
import type { Plan } from "../lib/plan/schema";
import { bookcasePlan, tablePlan } from "../tests/fixtures";

interface FlawCase {
  name: string;
  plan: Plan;
  /** per-flaw matcher run against issue text */
  flaws: Array<{ id: string; match: RegExp }>;
  req?: Partial<PlanRequest>;
}

const BASE_REQ: PlanRequest = {
  mode: "build",
  units: "metric",
  skillLevel: "intermediate",
  budget: "balanced",
  style: "match_photo",
  useMyToolsOnly: false,
  currency: "USD",
  imageCount: 0,
};

/** The original v1.2-era table: end-grain screws + cross-grain glue-up. */
const badTable: Plan = {
  ...tablePlan,
  joints: [
    {
      id: "J1", part_a: "P2", part_b: "P1", count: 4, type: "glue_screw",
      fasteners: [{ name: "Wood screws #8 x 50mm", size: "#8 x 50mm", qty_per_joint: 2 }],
      drive_from: "up through the leg end into the underside of the top",
      step: 2,
      note: "screws driven into the end grain of the turned legs",
    },
    {
      id: "J2", part_a: "P3", part_b: "P1", count: 1, type: "glue_screw",
      fasteners: [{ name: "Wood screws #8 x 38mm", size: "#8 x 38mm", qty_per_joint: 4 }],
      drive_from: "up through the cleat, which is already glued to the top",
      step: 2,
      note: "cleat glued along its full length across the grain of the solid top",
    },
  ],
  steps: [
    tablePlan.steps[0],
    {
      n: 2, title: "Attach cleat and legs",
      text: "Glue the cleat across the underside of the top and screw it down. Drive two screws up through the end of each leg into the top.",
      parts_used: ["P1", "P2", "P3"], tools_used: ["Drill/driver"],
    },
  ],
};

/** Tall bookcase, load-bearing, no anti-tip fixing. */
const noAntiTip: Plan = {
  ...bookcasePlan,
  load_bearing: true,
  joints: bookcasePlan.joints.filter((j) => j.type !== "wall_anchor" && j.type !== "stud_screw"),
  steps: bookcasePlan.steps.map((s) => ({
    ...s,
    text: s.text.replace(/anti-?tip|wall anchor|stud/gi, ""),
  })),
};

/** Bookcase whose assembly needs a biscuit joiner the user doesn't own. */
const missingTool: Plan = {
  ...bookcasePlan,
  tools: [
    { name: "Hand saw", required: true },
    { name: "Drill/driver", required: true },
    { name: "Biscuit joiner", required: true },
  ],
  steps: bookcasePlan.steps.map((s, i) =>
    i === 1
      ? {
          ...s,
          title: "Cut biscuit slots and dry-fit",
          text: "Cut #20 biscuit slots in the shelf ends and side panels with the biscuit joiner, then dry-fit the carcass.",
          tools_used: ["Biscuit joiner"],
        }
      : s
  ),
};

/** Shelf plan where a shelf rests on nothing (friction-fit claim). */
const shelfNoSupport: Plan = {
  ...bookcasePlan,
  title: "Wall Shelf with Floating Middle Shelf",
  summary: "A bookcase where the middle shelf floats between the sides with no fasteners — it is held by friction alone.",
  joints: bookcasePlan.joints.filter((j) => !(j.part_a === "P4" || j.part_b === "P4")),
  steps: bookcasePlan.steps.map((s) =>
    s.parts_used.includes("P4")
      ? { ...s, text: "Slide shelf P4 between the sides — it is a snug friction fit, no fasteners needed. Load it with books." }
      : s
  ),
};

/** Coffee-table style plan: solid top rigidly glued+screwed to aprons across grain. */
const gluedTop: Plan = {
  ...tablePlan,
  title: "Solid Oak Coffee Table, Aprons Glued to Top",
  summary: "A coffee table whose solid oak top is glued and screwed rigidly to the apron frame across the grain.",
  parts: tablePlan.parts.map((p) =>
    p.id === "P3" ? { ...p, name: "Apron frame", material: "Solid oak" } : p
  ),
  joints: [
    {
      id: "J1", part_a: "P2", part_b: "P1", count: 4, type: "leg_plate_hanger_bolt",
      fasteners: [
        { name: "Angled leg plate 12°", size: null, qty_per_joint: 1 },
        { name: "Hanger bolt 5/16 in", size: "5/16 in", qty_per_joint: 1 },
      ],
      drive_from: "through the plate into the top", step: 2, note: null,
    },
    {
      id: "J2", part_a: "P3", part_b: "P1", count: 1, type: "glue_screw",
      fasteners: [{ name: "Wood screws #8 x 38mm", size: "#8 x 38mm", qty_per_joint: 8 }],
      drive_from: "up through the apron into the top", step: 2,
      note: "aprons glued and screwed to the solid top across its full width",
    },
  ],
  steps: [
    tablePlan.steps[0],
    {
      n: 2, title: "Glue top to aprons",
      text: "Spread glue along the top edge of the apron frame, set the solid oak top on it, and drive eight screws up through the aprons into the top.",
      parts_used: ["P1", "P3"], tools_used: ["Drill/driver"],
    },
  ],
};

const CASES: FlawCase[] = [
  {
    name: "bad-table",
    plan: badTable,
    flaws: [
      { id: "end-grain screws", match: /end.?grain/i },
      { id: "cross-grain glue-up", match: /cross.?grain|wood movement|seasonal|movement|glue.*grain/i },
      { id: "blocked tool access", match: /access|reach|blocked|clearance|already.*attached|covered/i },
    ],
  },
  {
    name: "no-antitip-bookcase",
    plan: noAntiTip,
    flaws: [{ id: "missing anti-tip", match: /tip|anchor|wall|tall|topple|anti/i }],
  },
  {
    name: "missing-tool",
    plan: missingTool,
    req: { toolsOwned: ["Hand saw", "Drill/driver", "Hammer"], useMyToolsOnly: true },
    flaws: [{ id: "tool not owned", match: /biscuit|joiner|tool|inventory|own|required/i }],
  },
  {
    name: "floating-shelf",
    plan: shelfNoSupport,
    flaws: [{ id: "unsupported shelf", match: /shelf|support|float|friction|load/i }],
  },
  {
    name: "glued-solid-top",
    plan: gluedTop,
    flaws: [{ id: "cross-grain glue-up", match: /cross.?grain|wood movement|seasonal|movement|glue.*grain|solid top/i }],
  },
];

const RUNS = Math.max(1, parseInt(process.argv[process.argv.indexOf("--runs") + 1] || "3", 10) || 3);
const REVIEWERS = ["gpt-6-luna", "gpt-6.1-sol"];

async function main() {
  console.log(`Reviewer benchmark: ${CASES.length} flawed plans × ${REVIEWERS.length} models × ${RUNS} runs\n`);

  const grid = new Map<string, Map<string, number>>(); // flaw -> model -> catches
  const detail: Array<{ plan: string; model: string; run: number; verdict: string; caught: string[]; missed: string[] }> = [];

  const work: Array<() => Promise<void>> = [];
  for (const c of CASES)
    for (const model of REVIEWERS)
      for (let run = 0; run < RUNS; run++)
        work.push(async () => {
          const req = { ...BASE_REQ, ...c.req };
          const r = await callReview(JSON.stringify(c.plan), req, model);
          const nonMinor = r.issues.filter((i) => i.severity !== "minor");
          const text = nonMinor.map((i) => `${i.category} ${i.problem} ${i.fix}`).join(" | ");
          const caught = c.flaws.filter((f) => f.match.test(text)).map((f) => f.id);
          const missed = c.flaws.filter((f) => !f.match.test(text)).map((f) => f.id);
          for (const f of c.flaws) {
            const key = `${c.name}·${f.id}`;
            if (!grid.has(key)) grid.set(key, new Map());
            const m = grid.get(key)!;
            if (f.match.test(text)) m.set(model, (m.get(model) ?? 0) + 1);
            else m.set(model, m.get(model) ?? 0);
          }
          detail.push({ plan: c.name, model, run, verdict: r.verdict, caught, missed });
        });

  // 4 at a time to stay under rate limits
  const queue = [...work];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      let job: (() => Promise<void>) | undefined;
      while ((job = queue.shift())) await job().catch((e) => console.error("  call failed:", (e as Error).message));
    })
  );

  console.log("flaw                              | flaw type              | luna | sol");
  console.log("-".repeat(90));
  for (const c of CASES)
    for (const f of c.flaws) {
      const m = grid.get(`${c.name}·${f.id}`)!;
      console.log(
        `${c.name.padEnd(34)}| ${f.id.padEnd(22)} | ${(m.get("gpt-6-luna") ?? 0)}/${RUNS}  | ${(m.get("gpt-6.1-sol") ?? 0)}/${RUNS}`
      );
    }

  const totals = new Map<string, { caught: number; total: number }>();
  for (const [key, m] of grid)
    for (const model of REVIEWERS) {
      const t = totals.get(model) ?? { caught: 0, total: 0 };
      t.caught += m.get(model) ?? 0;
      t.total += RUNS;
      totals.set(model, t);
      void key;
    }
  console.log("-".repeat(90));
  for (const model of REVIEWERS) {
    const t = totals.get(model)!;
    console.log(`${model.padEnd(34)}| catch rate: ${t.caught}/${t.total} (${((t.caught / t.total) * 100).toFixed(0)}%)`);
  }

  writeFileSync(
    `eval/results/reviewer-bench-${Date.now()}.json`,
    JSON.stringify({ detail }, null, 2)
  );
  console.log("\ndetail → eval/results/reviewer-bench-*.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
