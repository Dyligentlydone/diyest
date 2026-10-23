/**
 * 2D profile paths — ported from blueprint-demo.html (reference renderer).
 * A part's profile lives in its own (u, v) plane in mm; these functions
 * flatten SVG path data / primitive profiles into closed polylines.
 */
import type { Profile } from "@/lib/plan/schema";

export type Vec2 = [number, number];

export function area2(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Force polygon winding: `want` true = counter-clockwise. */
export function ccw(poly: Vec2[], want: boolean): Vec2[] {
  const isCcw = area2(poly) > 0;
  return isCcw === want ? poly : [...poly].reverse();
}

function arcTo(
  poly: Vec2[],
  s: Vec2,
  e: Vec2,
  rx: number,
  ry: number,
  phi: number,
  fa: number,
  fs: number,
  seg: number
) {
  // SVG endpoint → center parameterization
  const cp = Math.cos(phi),
    sp = Math.sin(phi);
  const dx = (s[0] - e[0]) / 2,
    dy = (s[1] - e[1]) / 2;
  const x1 = cp * dx + sp * dy,
    y1 = -sp * dx + cp * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const l = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (l > 1) {
    rx *= Math.sqrt(l);
    ry *= Math.sqrt(l);
  }
  let k = Math.sqrt(
    Math.max(
      0,
      (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) /
        (rx * rx * y1 * y1 + ry * ry * x1 * x1)
    )
  );
  if (fa === fs) k = -k;
  const cx1 = (k * rx * y1) / ry,
    cy1 = (-k * ry * x1) / rx;
  const cx = cp * cx1 - sp * cy1 + (s[0] + e[0]) / 2,
    cy = sp * cx1 + cp * cy1 + (s[1] + e[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * (seg / 2)));
  for (let j = 1; j <= n; j++) {
    const t = t1 + (dt * j) / n;
    poly.push([
      cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp,
      cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp,
    ]);
  }
}

/**
 * Minimal SVG path flattener: M L H V Q C A Z (absolute and relative).
 * Returns closed polylines. Throws on malformed input.
 */
export function parsePath(d: string, seg = 24): Vec2[][] {
  const toks = d.match(/[MLHVQCAZmlhvqcaz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0,
    cmd = "";
  let cur: Vec2 = [0, 0],
    start: Vec2 = [0, 0];
  const out: Vec2[][] = [];
  let poly: Vec2[] = [];
  const num = () => {
    const v = parseFloat(toks[i++]);
    if (!Number.isFinite(v)) throw new Error(`malformed path data: "${d}"`);
    return v;
  };
  const push = (p: Vec2) => {
    poly.push(p);
    cur = p;
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(),
      C = cmd.toUpperCase();
    const P = (x: number, y: number): Vec2 =>
      rel ? [cur[0] + x, cur[1] + y] : [x, y];
    if (C === "M") {
      if (poly.length > 2) out.push(poly);
      poly = [];
      const p = P(num(), num());
      start = p;
      push(p);
      cmd = rel ? "l" : "L";
    } else if (C === "L") push(P(num(), num()));
    else if (C === "H") {
      const x = num();
      push([rel ? cur[0] + x : x, cur[1]]);
    } else if (C === "V") {
      const y = num();
      push([cur[0], rel ? cur[1] + y : y]);
    } else if (C === "Q") {
      const c1 = P(num(), num()),
        e = P(num(), num()),
        s0 = cur;
      for (let k = 1; k <= seg; k++) {
        const t = k / seg,
          m = 1 - t;
        poly.push([
          m * m * s0[0] + 2 * m * t * c1[0] + t * t * e[0],
          m * m * s0[1] + 2 * m * t * c1[1] + t * t * e[1],
        ]);
      }
      cur = e;
    } else if (C === "C") {
      const c1 = P(num(), num()),
        c2 = P(num(), num()),
        e = P(num(), num()),
        s0 = cur;
      for (let k = 1; k <= seg; k++) {
        const t = k / seg,
          m = 1 - t;
        poly.push([
          m * m * m * s0[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * e[0],
          m * m * m * s0[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * e[1],
        ]);
      }
      cur = e;
    } else if (C === "A") {
      const rx = num(),
        ry = num(),
        rot = (num() * Math.PI) / 180,
        large = num(),
        sweep = num(),
        e = P(num(), num());
      arcTo(poly, cur, e, rx, ry, rot, large, sweep, seg);
      cur = e;
    } else if (C === "Z") {
      if (poly.length > 2) out.push(poly);
      poly = [];
      cur = start;
    } else i++;
  }
  if (poly.length > 2) out.push(poly);
  return out.map((p) =>
    p.filter(
      (q, k) => k === 0 || Math.hypot(q[0] - p[k - 1][0], q[1] - p[k - 1][1]) > 1e-6
    )
  );
}

export interface ProfileLoops {
  outer: Vec2[];
  holes: Vec2[][];
}

/** Resolve a part profile to its flattened (u, v) loops inside the L × W box. */
export function profileLoops(
  profile: Profile | null | undefined,
  L: number,
  W: number
): ProfileLoops {
  const p = profile ?? { type: "rect" as const };
  const ell = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    a0: number,
    a1: number,
    n: number
  ): Vec2[] => {
    const o: Vec2[] = [];
    for (let k = 0; k <= n; k++) {
      const t = a0 + ((a1 - a0) * k) / n;
      o.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    return o;
  };
  if (p.type === "circle" || p.type === "ellipse")
    return { outer: ell(L / 2, W / 2, L / 2, W / 2, 0, 2 * Math.PI, 96).slice(0, -1), holes: [] };
  if (p.type === "rounded_rect") {
    const r = Math.min(p.radius || 0, L / 2, W / 2),
      H = Math.PI / 2,
      n = 10;
    return {
      outer: [
        ...ell(L - r, r, r, r, -H, 0, n),
        ...ell(L - r, W - r, r, r, 0, H, n),
        ...ell(r, W - r, r, r, H, 2 * H, n),
        ...ell(r, r, r, r, 2 * H, 3 * H, n),
      ],
      holes: [],
    };
  }
  if (p.type === "path") {
    const loops = parsePath(p.d);
    const holes = (p.holes || []).flatMap((h) => parsePath(h));
    if (!loops[0]) throw new Error("path profile has no outline");
    return { outer: loops[0], holes };
  }
  return {
    outer: [
      [0, 0],
      [L, 0],
      [L, W],
      [0, W],
    ],
    holes: [],
  };
}

/** Bounding box of a flattened profile, for the "stays inside L×W" check. */
export function loopsBounds(loops: ProfileLoops): { min: Vec2; max: Vec2 } {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  for (const pt of [loops.outer, ...loops.holes].flat()) {
    min[0] = Math.min(min[0], pt[0]);
    min[1] = Math.min(min[1], pt[1]);
    max[0] = Math.max(max[0], pt[0]);
    max[1] = Math.max(max[1], pt[1]);
  }
  return { min, max };
}
