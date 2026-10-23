/**
 * End-to-end test against a running dev server.
 *
 *   npx tsx scripts/e2e.ts [--image path/to/photo.jpg] [--base http://localhost:3003]
 *                          [--description "..."] [--width 800 --height 1800 --depth 300]
 *
 * Exercises the real /api/generate route (multipart form → model → validation),
 * independently re-validates the returned plan, checks the anonymous-usage
 * cookie, and writes artifacts to test-results/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { planSchema } from "../lib/plan/schema";

// ---------- args ----------
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = arg("base") ?? process.env.BASE_URL ?? "http://localhost:3003";
const IMAGE = arg("image");
const DESCRIPTION =
  arg("description") ??
  "A simple freestanding pine bookcase with 3 shelves, butt joints and screws";
const DIMS = {
  width: Number(arg("width") ?? 800),
  height: Number(arg("height") ?? 1800),
  depth: Number(arg("depth") ?? 300),
};

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail?: string) =>
  checks.push({ name, pass, detail });

void main();

async function main() {
// ---------- 1. page smoke checks ----------
for (const path of ["/", "/new", "/plan/draft"]) {
  const res = await fetch(`${BASE}${path}`);
  check(`GET ${path} → 200`, res.status === 200, `got ${res.status}`);
}

// ---------- 2. generation ----------
const payload = {
  description: DESCRIPTION,
  targetDimensionsMm: DIMS,
  units: "metric",
  skillLevel: "beginner",
  budget: "budget",
  style: IMAGE ? "match_photo" : "modern",
  currency: "USD",
};

const form = new FormData();
form.set("payload", JSON.stringify(payload));
if (IMAGE) {
  if (!existsSync(IMAGE)) throw new Error(`image not found: ${IMAGE}`);
  const buf = readFileSync(IMAGE);
  form.set(
    "images",
    new File([buf], basename(IMAGE), {
      type: IMAGE.endsWith(".png") ? "image/png" : "image/jpeg",
    })
  );
}

const t0 = Date.now();
const res = await fetch(`${BASE}/api/generate`, { method: "POST", body: form });
const wallMs = Date.now() - t0;
check("POST /api/generate → 200", res.status === 200, `got ${res.status}`);

const anonCookie = (res.headers.get("set-cookie") ?? "").match(/diyest_anon_gens=(\d+)/);
check("anonymous usage cookie incremented", !!anonCookie, anonCookie?.[0]);

const result = (await res.json()) as Record<string, unknown>;
check("result.ok === true", result.ok === true, String(result.kind ?? ""));

let planJson: unknown = null;
if (result.ok) {
  planJson = result.plan;

  // ---------- 3. independent re-validation ----------
  const parsed = planSchema.safeParse(planJson);
  check(
    "plan re-parses against planSchema",
    parsed.success,
    parsed.success ? undefined : parsed.error.issues.slice(0, 5).map((i) => i.message).join("; ")
  );

  if (parsed.success) {
    const d = parsed.data.overall_dimensions_mm;
    for (const [axis, target] of Object.entries(DIMS) as [keyof typeof DIMS, number][]) {
      const got = d[axis];
      check(
        `overall ${axis} ≈ ${target}mm (±5%)`,
        Math.abs(got - target) <= target * 0.05,
        `got ${got}`
      );
    }
  }

  check(
    "no unverified issues",
    Array.isArray(result.unverified) && result.unverified.length === 0,
    JSON.stringify(result.unverified)
  );
}

// ---------- 4. artifacts ----------
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = "test-results";
mkdirSync(dir, { recursive: true });
const file = join(dir, `run-${stamp}.json`);
writeFileSync(
  file,
  JSON.stringify(
    {
      base: BASE,
      at: new Date().toISOString(),
      request: { ...payload, image: IMAGE ?? null },
      wallMs,
      httpStatus: res.status,
      checks,
      response: result,
    },
    null,
    2
  )
);

// ---------- 5. report ----------
console.log(`\nE2E ${IMAGE ? "(with image)" : "(text only)"} — ${BASE}`);
console.log(`  wall time: ${(wallMs / 1000).toFixed(1)}s  HTTP ${res.status}`);
if (result.ok) {
  const p = planJson as { title?: string; parts?: unknown[]; steps?: unknown[] };
  console.log(
    `  plan: "${p.title}" — ${p.parts?.length} parts, ${p.steps?.length} steps, ` +
      `${result.tokens} tokens, repairs=${result.repairCount}, review=${(result.review as { verdict?: string } | null)?.verdict ?? "n/a"}`
  );
}
for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
console.log(`  artifact: ${file}`);
process.exit(checks.every((c) => c.pass) ? 0 : 1);
}
