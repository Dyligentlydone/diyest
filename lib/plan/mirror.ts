/**
 * Deterministic plan mirroring. Vision models are good at reading WHICH masses
 * a photo has but bad at left/right — a whole-class failure is a mirrored plan
 * (pedestal on the right when the photo shows it on the left). The review only
 * has to say "MIRRORED" for this to fix the geometry exactly: placements flip
 * about the plan's mid-line on the flagged axis, joints/steps (which reference
 * part ids, not positions) carry over untouched, and the footprint is
 * unchanged so overall_dimensions_mm stays valid.
 */
import type { Part, Plan } from "./schema";
import { boxAxes, bounds, solidsOf } from "@/lib/blueprint/solids";
import { parsePath } from "@/lib/blueprint/path";

const polyToPath = (pts: [number, number][]) =>
  `M ${pts[0][0]} ${pts[0][1]} ` +
  pts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(" ") +
  " Z";

/**
 * Mirror an SVG "path" profile about its own u or v centre line, re-serialized
 * as straight-line polygons (curves were already flattened by parsePath).
 * Mirroring flips winding, so each loop is reversed to restore orientation.
 */
function mirrorPathProfile(
  d: string,
  holes: string[] | null | undefined,
  sizeU: number,
  sizeV: number,
  flipU: boolean
): { d: string; holes: string[] } {
  const mirror = (s: string) =>
    parsePath(s).map((loop) => {
      const m = loop.map(([u, v]) =>
        (flipU ? [sizeU - u, v] : [u, sizeV - v]) as [number, number]
      );
      m.reverse();
      return polyToPath(m);
    });
  const outer = mirror(d);
  return { d: outer[0] ?? d, holes: (holes ?? []).flatMap((h) => mirror(h)) };
}

function mirrorPart(part: Part, lo: number, hi: number, axis: "x" | "z"): Part {
  const mid = lo + hi;
  const ax = axis === "x" ? 0 : 2;
  const placements = part.placements.map((pl) => {
    if ("from" in pl) {
      const from = [...pl.from] as [number, number, number];
      const to = [...pl.to] as [number, number, number];
      from[ax] = mid - from[ax];
      to[ax] = mid - to[ax];
      // mirroring flips chirality — negate roll so splayed legs stay true
      return { ...pl, from, to, roll_deg: pl.roll_deg ? -pl.roll_deg : pl.roll_deg };
    }
    const box = { ...pl };
    if (ax === 0) box.x = mid - pl.x - pl.sx;
    else box.z = mid - pl.z - pl.sz;
    return box;
  });

  // path profiles live in the part's own (u,v) plane — flip whichever of u/v
  // maps to the world axis being mirrored (u/v = the two largest box dims)
  let profile = part.profile;
  if (profile?.type === "path") {
    const boxPl = part.placements.find((p) => !("from" in p));
    if (boxPl && "x" in boxPl) {
      const [ua, va] = boxAxes(boxPl);
      const size = { x: boxPl.sx, y: boxPl.sy, z: boxPl.sz };
      try {
        if (ua === axis) {
          const m = mirrorPathProfile(profile.d, profile.holes, size[ua], size[va], true);
          profile = { ...profile, d: m.d, holes: m.holes };
        } else if (va === axis) {
          const m = mirrorPathProfile(profile.d, profile.holes, size[ua], size[va], false);
          profile = { ...profile, d: m.d, holes: m.holes };
        }
      } catch {
        /* unparseable path — leave it; validation already flags it */
      }
    }
  }

  return { ...part, placements, profile };
}

/** Mirror the whole plan about its bounding-box mid-plane on `axis` ("x" or "z"). */
export function mirrorPlanAxis(plan: Plan, axis: "x" | "z"): Plan {
  const B = bounds(solidsOf(plan));
  const lo = axis === "x" ? B.lo[0] : B.lo[2];
  const hi = axis === "x" ? B.hi[0] : B.hi[2];
  return { ...plan, parts: plan.parts.map((p) => mirrorPart(p, lo, hi, axis)) };
}
