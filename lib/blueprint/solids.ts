/**
 * 3D solid construction — ported from blueprint-demo.html.
 * Each part copy becomes a planar-face mesh:
 *   BoxPlacement parts  → profile extruded through its thickness
 *   AxisPlacement parts → cross-section swept from → to (tapered via end_*,
 *                         level ends cut parallel to the floor when ends="level")
 * These meshes drive validation (bounding box, overlap) and, in M3, the
 * blueprint renderer (edge extraction + depth-buffer hidden-line removal).
 */
import type { AxisPlacement, BoxPlacement, Part, Placement, Plan } from "@/lib/plan/schema";
import { ccw, profileLoops, type Vec2 } from "./path";

export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => mul(a, 1 / len(a));
const AX: Record<"x" | "y" | "z", Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export interface MeshFace {
  loops: number[][]; // first loop = outer ring, rest = holes
  n: Vec3;
}
export interface Mesh {
  verts: Vec3[];
  faces: MeshFace[];
}
export interface Solid {
  part: Part;
  placement: Placement;
  copy: number; // index of this placement within the part
  mesh: Mesh;
}
export type Axis = "x" | "y" | "z";

export function newellRaw(pts: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}
export function newell(pts: Vec3[]): Vec3 {
  return norm(newellRaw(pts));
}

interface Frame {
  map: (u: number, v: number, t: number) => Vec3;
  T: number;
}

function extrudeMesh(loops: { outer: Vec2[]; holes: Vec2[][] }, frame: Frame): Mesh {
  const { map, T } = frame;
  const outer = ccw(loops.outer, true),
    holes = loops.holes.map((h) => ccw(h, false));
  const verts: Vec3[] = [],
    faces: MeshFace[] = [];
  const ring = (poly: Vec2[], t: number) =>
    poly.map(([u, v]) => {
      verts.push(map(u, v, t));
      return verts.length - 1;
    });
  const bo = ring(outer, 0),
    to = ring(outer, T);
  const bh = holes.map((h) => ring(h, 0)),
    th = holes.map((h) => ring(h, T));
  const nT = norm(sub(map(0, 0, 1), map(0, 0, 0)));
  faces.push({ loops: [bo, ...bh], n: mul(nT, -1) }, { loops: [to, ...th], n: nT });
  const walls = (b: number[], t: number[]) => {
    for (let i = 0; i < b.length; i++) {
      const j = (i + 1) % b.length;
      const q = [b[i], b[j], t[j], t[i]];
      faces.push({ loops: [q], n: newell(q.map((k) => verts[k])) });
    }
  };
  walls(bo, to);
  bh.forEach((b, k) => walls(b, th[k]));
  return { verts, faces };
}

/** longest → u, middle → v, smallest → t; ties broken in x, y, z order. */
export function boxAxes(pl: { sx: number; sy: number; sz: number }): [Axis, Axis, Axis] {
  const entries: Array<[Axis, number, number]> = [
    ["x", pl.sx, 0],
    ["y", pl.sy, 1],
    ["z", pl.sz, 2],
  ];
  return entries.sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((e) => e[0]) as [
    Axis,
    Axis,
    Axis,
  ];
}

export function boxSolid(part: Part, pl: BoxPlacement): Mesh {
  const [ua, va, ta] = boxAxes(pl);
  const size: Record<Axis, number> = { x: pl.sx, y: pl.sy, z: pl.sz };
  const o: Vec3 = [pl.x, pl.y, pl.z];
  const L = size[ua],
    W = size[va],
    T = size[ta];
  // flip t when needed so the (u, v, t) frame is a proper rotation and face
  // normals point outward
  const flip = dot(cross(AX[ua], AX[va]), AX[ta]) < 0;
  const map = (u: number, v: number, t: number): Vec3 =>
    add(add(add(o, mul(AX[ua], u)), mul(AX[va], v)), mul(AX[ta], flip ? T - t : t));
  return extrudeMesh(profileLoops(part.profile, L, W), { map, T });
}

export function axisSolid(part: Part, pl: AxisPlacement): Mesh {
  const cs = part.cross_section ?? { shape: "rect" as const, w: 40, t: 40 };
  const A = pl.from,
    B = pl.to,
    d = norm(sub(B, A));
  const ref: Vec3 = Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  let a = norm(cross(ref, d)),
    b = cross(d, a);
  if (pl.roll_deg) {
    const r = (pl.roll_deg * Math.PI) / 180,
      c = Math.cos(r),
      s = Math.sin(r);
    [a, b] = [add(mul(a, c), mul(b, s)), add(mul(b, c), mul(a, -s))];
  }
  const sec = (end: boolean): Vec2[] =>
    cs.shape === "round"
      ? Array.from({ length: 48 }, (_, k) => {
          const t = (2 * Math.PI * k) / 48,
            r = ((end ? (cs.end_d || cs.d) : cs.d) as number) / 2;
          return [r * Math.cos(t), r * Math.sin(t)];
        })
      : (() => {
          const w = ((end ? (cs.end_w || cs.w) : cs.w) as number) / 2,
            t = ((end ? (cs.end_t || cs.t) : cs.t) as number) / 2;
          return [
            [-w, -t],
            [w, -t],
            [w, t],
            [-w, t],
          ];
        })();
  const level = part.ends === "level" && Math.abs(d[1]) > 0.2;
  const place = (C: Vec3, [p, q]: Vec2): Vec3 => {
    let P = add(C, add(mul(a, p), mul(b, q)));
    if (level) P = add(P, mul(d, (C[1] - P[1]) / d[1])); // slide onto horizontal end plane
    return P;
  };
  const verts: Vec3[] = [];
  const s0 = sec(false).map((pq) => {
    verts.push(place(A, pq));
    return verts.length - 1;
  });
  const s1 = sec(true).map((pq) => {
    verts.push(place(B, pq));
    return verts.length - 1;
  });
  const capN = (P: Vec3, Q: Vec3): Vec3 =>
    level ? [0, Math.sign(P[1] - Q[1]) || -1, 0] : norm(sub(P, Q));
  const faces: MeshFace[] = [
    { loops: [[...s0].reverse()], n: capN(A, B) },
    { loops: [s1], n: capN(B, A) },
  ];
  for (let i = 0; i < s0.length; i++) {
    const j = (i + 1) % s0.length;
    const q = [s0[i], s0[j], s1[j], s1[i]];
    faces.push({ loops: [q], n: newell(q.map((k) => verts[k])) });
  }
  return { verts, faces };
}

export interface SolidsPlan {
  parts: Array<Pick<Part, "id" | "name" | "placements"> & Partial<Part>>;
}

export function solidsOf(plan: Pick<Plan, "parts">): Solid[] {
  const out: Solid[] = [];
  plan.parts.forEach((part) =>
    part.placements.forEach((pl, k) =>
      out.push({
        part,
        placement: pl,
        copy: k,
        mesh: "from" in pl ? axisSolid(part, pl) : boxSolid(part, pl),
      })
    )
  );
  return out;
}

export function bounds(solids: Solid[]): { lo: Vec3; hi: Vec3 } {
  const lo: Vec3 = [Infinity, Infinity, Infinity],
    hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  solids.forEach((s) =>
    s.mesh.verts.forEach((v) => {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], v[i]);
        hi[i] = Math.max(hi[i], v[i]);
      }
    })
  );
  return { lo, hi };
}
