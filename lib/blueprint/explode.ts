/**
 * Exploded views and an interactive-ready 3D projection for plans.
 * Pure math on the existing solids — no rendering dependencies:
 * rotate → painter-sort faces → project isometric → polygons + edges.
 */
import type { Plan } from "@/lib/plan/schema";
import {
  add,
  bounds,
  mul,
  norm,
  solidsOf,
  sub,
  type Solid,
  type Vec3,
} from "./solids";
import type { Vec2 } from "./path";

/* ---------- transforms ---------- */

export function translate(s: Solid, d: Vec3): Solid {
  return {
    ...s,
    mesh: {
      verts: s.mesh.verts.map((v) => add(v, d)),
      faces: s.mesh.faces,
    },
  };
}

/** Push every solid away from the assembly centroid along its own offset. */
export function explodeSolids(solids: Solid[], factor: number): Solid[] {
  const B = bounds(solids);
  const c: Vec3 = [
    (B.lo[0] + B.hi[0]) / 2,
    (B.lo[1] + B.hi[1]) / 2,
    (B.lo[2] + B.hi[2]) / 2,
  ];
  const span = Math.max(B.hi[0] - B.lo[0], B.hi[1] - B.lo[1], B.hi[2] - B.lo[2]);
  return solids.map((s) => {
    const lo: Vec3 = [Infinity, Infinity, Infinity],
      hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const v of s.mesh.verts)
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], v[i]);
        hi[i] = Math.max(hi[i], v[i]);
      }
    const sc: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const off = sub(sc, c);
    const L = Math.hypot(off[0], off[1], off[2]);
    const dir: Vec3 = L > 1 ? mul(off, 1 / L) : [0, 1, 0];
    // mostly-outward with a vertical bias → reads like a classic exploded view
    const d: Vec3 = [
      dir[0] * span * factor * 0.55,
      Math.abs(off[1]) > 1 ? Math.sign(off[1]) * span * factor * 0.75 : 0,
      dir[2] * span * factor * 0.55,
    ];
    return translate(s, d);
  });
}

function rotateY(v: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
function rotateX(v: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/* ---------- painter's-projection ---------- */

export interface PaintedFace {
  /** projected 2D polygon (y up) */
  pts: Vec2[];
  /** depth for sorting — larger = farther */
  depth: number;
  partId: string;
  /** face is parallel-ish to the light direction → darker fill */
  shade: number;
  n: Vec3;
}

const COS30 = Math.cos(Math.PI / 6);

/**
 * Rotate all solids by yaw (around Y) + pitch (around X), project to
 * isometric-ish 2D, and return faces sorted back-to-front for painting.
 */
export function projectPainter(
  solids: Solid[],
  yawDeg = 30,
  pitchDeg = -30
): PaintedFace[] {
  const T = (v: Vec3): Vec3 => rotateX(rotateY(v, yawDeg), pitchDeg);
  const faces: PaintedFace[] = [];
  const light = norm([-0.5, -1, -0.3]);
  for (const s of solids) {
    const rv = s.mesh.verts.map(T);
    s.mesh.faces.forEach((f) => {
      const pts3 = f.loops[0].map((i) => rv[i]);
      const n = f.n;
      const rn = norm(rotateX(rotateY(n, yawDeg), pitchDeg));
      // iso projection: u = (x - z)cos30, v = y + (x + z)/2
      const pts: Vec2[] = pts3.map((p) => [
        (p[0] - p[2]) * COS30,
        p[1] + (p[0] + p[2]) * 0.5,
      ]);
      const depth = pts3.reduce((a, p) => a + (p[0] - p[1] + p[2]), 0) / pts3.length;
      const facing = rn[0] * 1 + rn[1] * -1 + rn[2] * 1; // view dir ~(1,-1,1)
      if (facing <= 0) return; // back face
      faces.push({
        pts,
        depth,
        partId: s.part.id,
        shade: Math.max(0.15, -((rn[0] * light[0] + rn[1] * light[1] + rn[2] * light[2]))),
        n: rn,
      });
    });
  }
  return faces.sort((a, b) => b.depth - a.depth);
}

/* ---------- static exploded sheet ---------- */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (x: number) => x.toFixed(1);

export function renderExplodedSvg(
  plan: Plan,
  opts: { factor?: number; variant?: "blueprint" | "print" } = {}
): string {
  const factor = opts.factor ?? 0.28;
  const print = opts.variant === "print";
  const solids = explodeSolids(solidsOf(plan), factor);
  const faces = projectPainter(solids);
  if (!faces.length) return "";

  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (const f of faces)
    for (const [u, v] of f.pts) {
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
  const W = 700,
    pad = 30,
    k = Math.min((W - pad * 2) / (u1 - u0), (560 - pad * 2) / (v1 - v0));
  const H = Math.ceil((v1 - v0) * k + pad * 2);
  const T = ([u, v]: Vec2): Vec2 => [
    pad + (u - u0) * k,
    pad + (v1 - v) * k,
  ];

  const line = print ? "#1a1a1a" : "#eaf3ff";
  const bg = print ? "#ffffff" : "#0b4f9c";
  const partIds = [...new Set(faces.map((f) => f.partId))];
  const polys = faces
    .map((f) => {
      const p = f.pts.map((q) => T(q).map(r1).join(",")).join(" ");
      const l = Math.round(255 - f.shade * 140);
      const fill = print
        ? `rgb(${l},${l},${l})`
        : `rgb(${Math.round(l * 0.55)},${Math.round(l * 0.75)},${l})`;
      return `<polygon points="${p}" fill="${fill}" stroke="${line}" stroke-width="0.8" stroke-linejoin="round"/>`;
    })
    .join("");

  // circled part labels at each part's top-most face
  const labels = partIds
    .map((id) => {
      const top = faces
        .filter((f) => f.partId === id)
        .flatMap((f) => f.pts)
        .sort((a, b) => b[1] - a[1])[0];
      const [x, y] = T(top);
      return `<g><circle cx="${r1(x + 6)}" cy="${r1(y - 10)}" r="10" fill="${print ? "#fff" : bg}" stroke="${line}" stroke-width="1"/>
        <text x="${r1(x + 6)}" y="${r1(y - 6)}" text-anchor="middle" font-size="10" fill="${line}">${esc(id)}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Courier New, monospace">
    <rect width="${W}" height="${H}" fill="${bg}"/>${polys}${labels}</svg>`;
}
