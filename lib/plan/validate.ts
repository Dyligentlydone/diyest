/**
 * Plan validation — runs after every generation/modification (brief §6).
 * Errors feed the one-shot AI repair loop; warnings are shown on the plan.
 */
import {
  isAxisPlacement,
  type AxisPlacement,
  type BoxPlacement,
  type Part,
  type Plan,
} from "./schema";
import { boxAxes, bounds, len, solidsOf, sub, type Solid } from "@/lib/blueprint/solids";
import { loopsBounds, profileLoops } from "@/lib/blueprint/path";
import { findOverlaps } from "./overlap";

export interface ValidationContext {
  targetDimensionsMm?: { width?: number; depth?: number; height?: number };
  toolsOwned?: string[];
  useMyToolsOnly?: boolean;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const MM_TOL = 1; // placement/size agreement tolerance
const BBOX_TOL = 2; // overall bounding box tolerance
const MAX_PART_MM = 5000;
/** Volume (mm³) above which an unexplained solid intersection is an error. */
const OVERLAP_VOLUME_MIN = 10_000;
const JOINERY_NOTE = /dado|tenon|mortise|rabbet|groove|notch|lap|dowel|pocket|inset|housed|join/i;

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const close = (a: number, b: number, tol = MM_TOL) => Math.abs(a - b) <= tol;
const axisLen = (p: AxisPlacement) => len(sub(p.to, p.from));

function aabb(s: Solid): { lo: Vec3Like; hi: Vec3Like } {
  const lo: Vec3Like = [Infinity, Infinity, Infinity];
  const hi: Vec3Like = [-Infinity, -Infinity, -Infinity];
  for (const v of s.mesh.verts)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], v[i]);
      hi[i] = Math.max(hi[i], v[i]);
    }
  return { lo, hi };
}
type Vec3Like = [number, number, number];

function checkPart(part: Part, maxDim: number, errors: string[], warnings: string[]) {
  const label = `${part.id} (${part.name})`;

  for (const dim of [part.length_mm, part.width_mm, part.thickness_mm]) {
    if (!(dim > 0)) errors.push(`${label}: non-positive dimension ${dim}`);
    if (dim > maxDim)
      errors.push(`${label}: dimension ${dim}mm exceeds sane maximum ${maxDim}mm`);
  }
  if (part.qty > 200) warnings.push(`${label}: unusual quantity ${part.qty}`);

  const placements = part.placements;
  if (placements.length !== part.qty)
    errors.push(
      `${label}: placements.length ${placements.length} !== qty ${part.qty}`
    );
  const kinds = new Set(placements.map((p) => (isAxisPlacement(p) ? "axis" : "box")));
  if (kinds.size > 1)
    errors.push(`${label}: mixes box and axis placements — all copies must be one kind`);

  for (const [i, pl] of placements.entries()) {
    const tag = `${label} copy ${i + 1}`;
    if (isAxisPlacement(pl)) {
      checkAxis(part, pl, tag, errors);
    } else {
      checkBox(part, pl, tag, errors);
    }
  }

  if (placements.some(isAxisPlacement) && !part.cross_section)
    errors.push(`${label}: axis placements require cross_section`);
  if (part.ends === "level" && placements.every((p) => !isAxisPlacement(p)))
    warnings.push(`${label}: ends "level" only applies to axis placements`);
}

function checkBox(part: Part, pl: BoxPlacement, tag: string, errors: string[]) {
  const expected = sorted([part.length_mm, part.width_mm, part.thickness_mm]);
  const actual = sorted([pl.sx, pl.sy, pl.sz]);
  if (!expected.every((e, i) => close(e, actual[i])))
    errors.push(
      `${tag}: box size [${pl.sx},${pl.sy},${pl.sz}] ≠ part dims [${part.length_mm},${part.width_mm},${part.thickness_mm}]`
    );

  if (part.profile?.type === "path") {
    try {
      const [ua, va] = boxAxes(pl);
      const size = { x: pl.sx, y: pl.sy, z: pl.sz };
      const loops = profileLoops(part.profile, size[ua], size[va]);
      const b = loopsBounds(loops);
      const TOL = 0.5;
      if (
        b.min[0] < -TOL ||
        b.min[1] < -TOL ||
        b.max[0] > size[ua] + TOL ||
        b.max[1] > size[va] + TOL
      )
        errors.push(
          `${tag}: profile path leaves its ${Math.round(size[ua])}×${Math.round(size[va])} box`
        );
    } catch (e) {
      errors.push(`${tag}: profile path fails to parse (${(e as Error).message})`);
    }
  }
}

function checkAxis(part: Part, pl: AxisPlacement, tag: string, errors: string[]) {
  const L = axisLen(pl);
  if (!close(L, part.length_mm))
    errors.push(
      `${tag}: axis length ${L.toFixed(1)}mm ≠ length_mm ${part.length_mm}mm`
    );

  const cs = part.cross_section;
  if (cs) {
    if (cs.shape === "round") {
      if (!close(cs.d, part.width_mm) || !close(cs.d, part.thickness_mm))
        errors.push(
          `${tag}: round cross-section ⌀${cs.d} ≠ width/thickness ${part.width_mm}/${part.thickness_mm}`
        );
    } else {
      const exp = sorted([part.width_mm, part.thickness_mm]);
      const act = sorted([cs.w, cs.t]);
      if (!exp.every((e, i) => close(e, act[i])))
        errors.push(
          `${tag}: cross-section ${cs.w}×${cs.t} ≠ width/thickness ${part.width_mm}×${part.thickness_mm}`
        );
    }
  }

  if (part.ends === "level" && Math.min(pl.from[1], pl.to[1]) > 2)
    errors.push(`${tag}: ends "level" but neither end reaches the floor (y≈0)`);
}

export async function validatePlan(
  plan: Plan,
  ctx: ValidationContext = {}
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- structural checks ----
  if (!plan.parts.length) errors.push("Plan has no parts");
  if (plan.est_cost.low > plan.est_cost.high)
    errors.push("est_cost.low exceeds est_cost.high");
  if (plan.clarifying_questions.length > 3)
    warnings.push("More than 3 clarifying questions returned");

  const ids = new Set(plan.parts.map((p) => p.id));
  if (ids.size !== plan.parts.length) errors.push("Duplicate part ids");

  const used = new Set(plan.steps.flatMap((s) => s.parts_used));
  for (const s of plan.steps)
    for (const pid of s.parts_used)
      if (!ids.has(pid)) errors.push(`Step ${s.n} references unknown part "${pid}"`);
  for (const p of plan.parts)
    if (!used.has(p.id)) errors.push(`Part ${p.id} (${p.name}) is not used in any step`);

  const stepNums = plan.steps.map((s) => s.n);
  if (new Set(stepNums).size !== stepNums.length) errors.push("Duplicate step numbers");

  // ---- per-part checks ----
  const targetMax = ctx.targetDimensionsMm
    ? Math.max(
        MAX_PART_MM,
        ctx.targetDimensionsMm.width ?? 0,
        ctx.targetDimensionsMm.depth ?? 0,
        ctx.targetDimensionsMm.height ?? 0
      )
    : MAX_PART_MM;
  for (const p of plan.parts) {
    checkPart(p, targetMax, errors, warnings);
    if (p.source === "buy" && !p.buy_spec?.trim())
      errors.push(`${p.id} (${p.name}): source "buy" requires a buy_spec`);
  }

  // ---- joints (v1.3): structural declarations must cover reality ----
  const jointIds = new Set<string>();
  const jointPairs = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  for (const j of plan.joints) {
    if (jointIds.has(j.id)) errors.push(`Duplicate joint id ${j.id}`);
    jointIds.add(j.id);
    if (!ids.has(j.part_a))
      errors.push(`Joint ${j.id} references unknown part_a "${j.part_a}"`);
    if (!ids.has(j.part_b) && j.part_b !== "FLOOR" && j.part_b !== "WALL")
      errors.push(`Joint ${j.id} references unknown part_b "${j.part_b}"`);
    if (j.part_a === j.part_b)
      errors.push(`Joint ${j.id} joins part ${j.part_a} to itself`);
    jointPairs.add(pairKey(j.part_a, j.part_b));

    const step = plan.steps.find((s) => s.n === j.step);
    if (!step) {
      errors.push(`Joint ${j.id} is made in step ${j.step}, which doesn't exist`);
    } else {
      if (!step.parts_used.includes(j.part_a))
        errors.push(`Joint ${j.id} made in step ${j.step} but its parts_used lacks ${j.part_a}`);
      if (ids.has(j.part_b) && !step.parts_used.includes(j.part_b))
        errors.push(`Joint ${j.id} made in step ${j.step} but its parts_used lacks ${j.part_b}`);
    }
  }

  // hardware quantities must equal the sum of joint fasteners (name-matched)
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const fastenerTotals = new Map<string, number>();
  const fastenerNames = new Map<string, string>();
  for (const j of plan.joints)
    for (const f of j.fasteners) {
      const k = normName(f.name);
      fastenerTotals.set(k, (fastenerTotals.get(k) ?? 0) + f.qty_per_joint * j.count);
      fastenerNames.set(k, f.name);
    }
  const hwMatched = new Set<string>();
  for (const [fk, total] of fastenerTotals) {
    const hw = plan.hardware.find(
      (h) => normName(h.name) === fk || normName(h.name).includes(fk) || fk.includes(normName(h.name))
    );
    if (!hw)
      errors.push(
        `Fastener "${fastenerNames.get(fk)}" used by joints (×${total}) is missing from the hardware list`
      );
    else {
      hwMatched.add(hw.name);
      if (hw.qty !== total)
        errors.push(
          `Hardware "${hw.name}" qty ${hw.qty} ≠ joints total ${total} (sum of qty_per_joint × count)`
        );
    }
  }
  for (const h of plan.hardware)
    if (!hwMatched.has(h.name))
      warnings.push(`Hardware "${h.name}" isn't referenced by any joint`);

  // ---- geometry checks (real meshes) ----
  let solids: Solid[] = [];
  try {
    solids = solidsOf(plan);
  } catch (e) {
    errors.push(`Failed to build part geometry: ${(e as Error).message}`);
  }

  if (solids.length) {
    const b = bounds(solids);
    const dims = plan.overall_dimensions_mm;
    const got = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
    const want = [dims.width, dims.height, dims.depth];
    if (!want.every((w, i) => Math.abs(w - got[i]) <= BBOX_TOL))
      errors.push(
        `Bounding box ${got.map((v) => Math.round(v)).join("×")}mm ≠ overall_dimensions_mm ${want.join("×")}`
      );

    // overlap: exact intersection volumes via manifold-3d
    try {
      const { hits, unverifiable } = await findOverlaps(solids);
      for (const h of hits) {
        const joineryNoted = [h.a, h.b].some((label) => {
          const pid = label.split(" ")[0];
          const part = plan.parts.find((p) => p.id === pid);
          return part?.notes && JOINERY_NOTE.test(part.notes);
        });
        if (h.volumeMm3 > OVERLAP_VOLUME_MIN && !joineryNoted)
          errors.push(
            `Solids intersect: ${h.a} × ${h.b} overlap ${Math.round(h.volumeMm3)}mm³ (parts may touch, not pass through — note joinery if intentional)`
          );
      }
      for (const pid of unverifiable)
        warnings.push(`Part ${pid}: geometry could not be verified for overlap`);
    } catch (e) {
      warnings.push(`Overlap check unavailable: ${(e as Error).message}`);
    }

    // nothing floats: each solid touches the floor (y≈0) or another solid's AABB
    const boxes = solids.map(aabb);
    for (const [i, s] of solids.entries()) {
      if (boxes[i].lo[1] <= MM_TOL) continue;
      const supported = boxes.some(
        (other, j) =>
          j !== i &&
          boxes[i].lo[0] <= other.hi[0] + MM_TOL &&
          boxes[i].hi[0] >= other.lo[0] - MM_TOL &&
          boxes[i].lo[1] <= other.hi[1] + MM_TOL &&
          boxes[i].hi[1] >= other.lo[1] - MM_TOL &&
          boxes[i].lo[2] <= other.hi[2] + MM_TOL &&
          boxes[i].hi[2] >= other.lo[2] - MM_TOL
      );
      if (!supported)
        errors.push(`${s.part.id} (${s.part.name}) copy ${s.copy + 1} floats in mid-air`);
    }

    // joint coverage: every pair of different-part solids that touch (AABBs
    // within 1mm) must have a declared joint between their part ids.
    // Exempted: same-part contacts, and pairs where both parts rest on the
    // floor (incidental ground-level contact needs no joinery).
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const A = solids[i],
          Bs = solids[j];
        if (A.part.id === Bs.part.id) continue;
        const a = boxes[i],
          b = boxes[j];
        if (a.lo[1] <= MM_TOL && b.lo[1] <= MM_TOL) continue;
        const touching =
          a.lo[0] <= b.hi[0] + MM_TOL &&
          a.hi[0] >= b.lo[0] - MM_TOL &&
          a.lo[1] <= b.hi[1] + MM_TOL &&
          a.hi[1] >= b.lo[1] - MM_TOL &&
          a.lo[2] <= b.hi[2] + MM_TOL &&
          a.hi[2] >= b.lo[2] - MM_TOL;
        if (touching && !jointPairs.has(pairKey(A.part.id, Bs.part.id)))
          errors.push(
            `Parts ${A.part.id} (${A.part.name}) and ${Bs.part.id} (${Bs.part.name}) touch but have no declared joint`
          );
      }
    }
  }

  // ---- user constraints ----
  const t = ctx.targetDimensionsMm;
  if (t) {
    const d = plan.overall_dimensions_mm;
    const pairs: Array<[number | undefined, number, string]> = [
      [t.width, d.width, "width"],
      [t.depth, d.depth, "depth"],
      [t.height, d.height, "height"],
    ];
    for (const [want, got, name] of pairs)
      if (want && Math.abs(got - want) > want * 0.05)
        errors.push(
          `Overall ${name} ${Math.round(got)}mm differs from target ${want}mm by more than 5%`
        );
  }

  if (ctx.useMyToolsOnly && ctx.toolsOwned?.length) {
    const owned = new Set(ctx.toolsOwned.map((s) => s.toLowerCase()));
    for (const tool of plan.tools)
      if (tool.required && !owned.has(tool.name.toLowerCase()))
        errors.push(
          `Required tool "${tool.name}" is not in the user's inventory (use-my-tools-only was on)`
        );
  }

  if (plan.load_bearing) {
    for (const p of plan.parts) {
      // horizontal flat members (shelves, seats) carrying load need ≥18mm
      const isHorizontalSlab = p.placements.every(
        (pl) => !isAxisPlacement(pl) && pl.sy <= Math.min(pl.sx, pl.sz)
      );
      const longSpan = p.placements.some(
        (pl) => !isAxisPlacement(pl) && Math.max(pl.sx, pl.sz) > 600
      );
      if (isHorizontalSlab && longSpan && p.thickness_mm < 18)
        errors.push(
          `${p.id} (${p.name}): load-bearing horizontal part is only ${p.thickness_mm}mm thick (<18mm minimum)`
        );
    }
    if (!plan.steps.some((s) => s.safety))
      warnings.push("load_bearing plan has no step-level safety notes");
  }

  return { errors, warnings };
}
