/**
 * Blueprint sheet renderer — ported from blueprint-demo.html.
 *
 *   Plan → solids → per-view projection + depth-buffer hidden-line removal
 *        → SVG: 3 orthographic views + isometric, overall dimensions, chained
 *          spacing dims, angle marks, ⌀/R callouts, parts table, title block.
 *
 * Everything on the sheet is computed from plan numbers — nothing hand-placed,
 * nothing drawn by a model.
 */
import type { AxisPlacement, Part, Plan } from "@/lib/plan/schema";
import { isAxisPlacement } from "@/lib/plan/schema";
import { formatDimension } from "@/lib/units";
import type { Units } from "@/lib/types";
import type { Vec2 } from "./path";
import {
  add,
  boxAxes,
  bounds,
  dot,
  len,
  newellRaw,
  norm,
  solidsOf,
  sub,
  type Solid,
  type Vec3,
} from "./solids";

const r1 = (x: number) => x.toFixed(1);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- views & hidden-line removal ---------- */
// Each view maps world → [u (right), v (up), depth (away from viewer)].
interface View {
  dir: Vec3;
  P: (p: Vec3) => Vec3;
}
const COS30 = Math.cos(Math.PI / 6);
const VIEWS: Record<"front" | "top" | "side" | "iso", View> = {
  front: { dir: [0, 0, 1], P: (p) => [p[0], p[1], p[2]] },
  top: { dir: [0, -1, 0], P: (p) => [p[0], p[2], -p[1]] },
  side: { dir: [-1, 0, 0], P: (p) => [p[2], p[1], -p[0]] },
  iso: {
    dir: norm([1, -1, 1]),
    P: (p) => [
      (p[0] - p[2]) * COS30,
      p[1] + (p[0] + p[2]) * 0.5,
      (p[0] - p[1] + p[2]) / Math.sqrt(3),
    ],
  },
};

interface Edge {
  a: number;
  b: number;
  f: number[];
}
function edgesOf(mesh: Solid["mesh"]): Edge[] {
  const map = new Map<string, Edge>();
  mesh.faces.forEach((f, fi) =>
    f.loops.forEach((l) =>
      l.forEach((a, i) => {
        const b = l[(i + 1) % l.length];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!map.has(key)) map.set(key, { a, b, f: [] });
        map.get(key)!.f.push(fi);
      })
    )
  );
  return [...map.values()];
}

interface ViewBox {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

// Software depth buffer: every planar face is scan-filled (even-odd, so holes
// work) with its plane's depth.
function depthBuffer(solids: Solid[], view: View, box: ViewBox, res: number) {
  const W = Math.ceil((box.u1 - box.u0) * res) + 3,
    H = Math.ceil((box.v1 - box.v0) * res) + 3;
  const buf = new Float32Array(W * H).fill(Infinity);
  const px = (q: Vec3): Vec3 => [
    (q[0] - box.u0) * res + 1,
    (box.v1 - q[1]) * res + 1,
    q[2],
  ];
  for (const s of solids) {
    const pv = s.mesh.verts.map((v) => px(view.P(v)));
    for (const f of s.mesh.faces) {
      // plane through the projected face, in pixel space (works for any linear
      // view, incl. isometric)
      const n = newellRaw(f.loops[0].map((i) => pv[i]));
      const p0 = pv[f.loops[0][0]];
      if (Math.abs(n[2]) < 1e-6 * Math.hypot(n[0], n[1], n[2]) || !isFinite(n[2]))
        continue; // seen edge-on
      const depthAt = (x: number, y: number) =>
        p0[2] - (n[0] * (x - p0[0]) + n[1] * (y - p0[1])) / n[2];
      const segs: [Vec3, Vec3][] = [];
      let y0 = Infinity,
        y1 = -Infinity;
      f.loops.forEach((l) =>
        l.forEach((vi, i) => {
          const a = pv[vi],
            b = pv[l[(i + 1) % l.length]];
          segs.push([a, b]);
          y0 = Math.min(y0, a[1]);
          y1 = Math.max(y1, a[1]);
        })
      );
      for (
        let y = Math.max(0, Math.floor(y0));
        y <= Math.min(H - 1, Math.ceil(y1));
        y++
      ) {
        const yc = y + 0.5,
          xs: number[] = [];
        for (const [a, b] of segs)
          if (a[1] <= yc !== b[1] <= yc)
            xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        xs.sort((m, k) => m - k);
        for (let k = 0; k + 1 < xs.length; k += 2)
          for (
            let x = Math.max(0, Math.ceil(xs[k] - 0.5));
            x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
            x++
          ) {
            const dz = depthAt(x + 0.5, yc),
              idx = y * W + x;
            if (dz < buf[idx]) buf[idx] = dz;
          }
      }
    }
  }
  return { buf, W, H, px };
}

export interface DrawnView {
  visible: Vec2[][];
  hidden: Vec2[][];
  /** visible edges of the highlighted part (drawn in accent color) */
  highlight: Vec2[][];
  box: ViewBox;
}

// Returns { visible, hidden } polylines in view (u, v) coordinates.
export function drawView(
  solids: Solid[],
  viewName: keyof typeof VIEWS,
  highlightPartId?: string
): DrawnView {
  const view = VIEWS[viewName];
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity,
    dmin = Infinity,
    dmax = -Infinity;
  solids.forEach((s) =>
    s.mesh.verts.forEach((p) => {
      const q = view.P(p);
      u0 = Math.min(u0, q[0]);
      u1 = Math.max(u1, q[0]);
      v0 = Math.min(v0, q[1]);
      v1 = Math.max(v1, q[1]);
      dmin = Math.min(dmin, q[2]);
      dmax = Math.max(dmax, q[2]);
    })
  );
  const box = { u0, u1, v0, v1 },
    res = 1400 / Math.max(u1 - u0, v1 - v0); // depth-buffer pixels per mm
  const { buf, W, H, px } = depthBuffer(solids, view, box, res);
  const eps = Math.max(0.8, (dmax - dmin) * 0.002) + 1.5 / res;
  const look = view.dir,
    vis: [Vec2, Vec2][] = [],
    hid: [Vec2, Vec2][] = [],
    hlt: [Vec2, Vec2][] = [];
  for (const s of solids) {
    const m = s.mesh;
    const bucket = s.part.id === highlightPartId ? hlt : vis;
    for (const e of edgesOf(m)) {
      // which edges belong on a drawing: outline/creases, plus silhouettes of
      // curved surfaces
      let draw = e.f.length !== 2;
      if (!draw) {
        const n1 = m.faces[e.f[0]].n,
          n2 = m.faces[e.f[1]].n;
        draw =
          dot(n1, n2) < Math.cos((25 * Math.PI) / 180) ||
          Math.sign(dot(n1, look)) !== Math.sign(dot(n2, look));
      }
      if (!draw) continue;
      const A = view.P(m.verts[e.a]),
        B = view.P(m.verts[e.b]);
      const a = px(A),
        b = px(B),
        n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.0));
      let runStart = 0,
        runVis: boolean | null = null;
      const flush = (i: number) => {
        if (runVis === null) return;
        const t0 = runStart / n,
          t1 = i / n;
        const P0: Vec2 = [A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0],
          P1: Vec2 = [A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1];
        (runVis ? bucket : hid).push([P0, P1]);
      };
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          x = a[0] + (b[0] - a[0]) * t,
          y = a[1] + (b[1] - a[1]) * t,
          z = a[2] + (b[2] - a[2]) * t;
        let far = -Infinity;
        const xi = Math.floor(x),
          yi = Math.floor(y);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = xi + dx,
              Y = yi + dy;
            far = Math.max(
              far,
              X < 0 || Y < 0 || X >= W || Y >= H ? Infinity : buf[Y * W + X]
            );
          }
        const v = z <= far + eps;
        if (runVis === null) {
          runVis = v;
          runStart = i;
        } else if (v !== runVis) {
          flush(i);
          runVis = v;
          runStart = i;
        }
      }
      flush(n);
    }
  }
  return { visible: chain(vis), hidden: chain(hid), highlight: chain(hlt), box };
}

// join touching segments into polylines so curves and dashes look continuous
function chain(segs: [Vec2, Vec2][]): Vec2[][] {
  const key = (p: Vec2) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const at = new Map<string, number[]>();
  segs.forEach((s, i) =>
    [0, 1].forEach((e) => {
      const k = key(s[e]);
      if (!at.has(k)) at.set(k, []);
      at.get(k)!.push(i);
    })
  );
  const used = new Array(segs.length).fill(false),
    out: Vec2[][] = [];
  const nextFrom = (p: Vec2) => (at.get(key(p)) || []).find((i) => !used[i]);
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line: Vec2[] = [segs[i][0], segs[i][1]];
    for (const end of [1, 0]) {
      let p = end ? line[line.length - 1] : line[0],
        j: number | undefined;
      while ((j = nextFrom(p)) !== undefined) {
        used[j] = true;
        const q = key(segs[j][0]) === key(p) ? segs[j][1] : segs[j][0];
        if (end) line.push(q);
        else line.unshift(q);
        p = q;
      }
    }
    out.push(line);
  }
  return out;
}

/* ---------- sheet ---------- */
const SHEET_W = 1100,
  SHEET_H = 780;

function placeView(drawn: DrawnView, ox: number, oy: number, s: number) {
  // view coords → sheet coords (v up → y down)
  const T = (q: readonly number[]): Vec2 => [
    ox + (q[0] - drawn.box.u0) * s,
    oy + (drawn.box.v1 - q[1]) * s,
  ];
  const pl = (lines: Vec2[][], cls: string) =>
    lines
      .map((l) => `<polyline points="${l.map((q) => T(q).map(r1).join(",")).join(" ")}" class="${cls}"/>`)
      .join("");
  return {
    T,
    svg: pl(drawn.hidden, "hid") + pl(drawn.visible, "vis") + pl(drawn.highlight, "hlt"),
  };
}

function dimH(x1: number, x2: number, y: number, ext: number, label: string) {
  return `<line x1="${x1}" y1="${ext}" x2="${x1}" y2="${y + 6}" class="ext"/><line x1="${x2}" y1="${ext}" x2="${x2}" y2="${y + 6}" class="ext"/>
    <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="dim" marker-start="url(#a)" marker-end="url(#a)"/>
    <text x="${(x1 + x2) / 2}" y="${y - 6}" text-anchor="middle" class="lbl">${label}</text>`;
}
function dimV(y1: number, y2: number, x: number, ext: number, label: string, side = 1) {
  const tx = x - 8 * side,
    cy = (y1 + y2) / 2;
  return `<line x1="${ext}" y1="${y1}" x2="${x + 6 * side}" y2="${y1}" class="ext"/><line x1="${ext}" y1="${y2}" x2="${x + 6 * side}" y2="${y2}" class="ext"/>
    <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" class="dim" marker-start="url(#a)" marker-end="url(#a)"/>
    <text x="${tx}" y="${cy}" text-anchor="middle" class="lbl" transform="rotate(-90 ${tx} ${cy})">${label}</text>`;
}
// angle between a member and vertical, drawn at its lower end
function angleMark(
  T: (q: readonly number[]) => Vec2,
  P: (p: Vec3) => Vec3,
  low: Vec3,
  high: Vec3
) {
  const a = T(P(low)),
    b = T(P(high)),
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    L = Math.hypot(dx, dy);
  const ang = (Math.atan2(Math.abs(dx), -dy) * 180) / Math.PI;
  if (ang < 0.5) return "";
  const r = 46,
    ux = dx / L,
    uy = dy / L,
    ex = a[0] + ux * r,
    ey = a[1] + uy * r;
  return `<line x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(a[0])}" y2="${r1(a[1] - r - 16)}" class="ext"/>
    <path d="M${r1(a[0])} ${r1(a[1] - r)} A${r} ${r} 0 0 ${dx > 0 ? 1 : 0} ${r1(ex)} ${r1(ey)}" class="dim" fill="none"/>
    <text x="${r1(a[0] + (dx > 0 ? -6 : 6))}" y="${r1(a[1] - r + 4)}" text-anchor="${dx > 0 ? "end" : "start"}" class="lbl">${ang.toFixed(1)}°</text>`;
}

function partSize(part: Part, fmt: (mm: number) => string) {
  const pl = part.placements[0];
  if (isAxisPlacement(pl)) {
    const cs = part.cross_section ?? { shape: "rect" as const, w: 40, t: 40 };
    const L = len(sub(pl.to, pl.from));
    const sec =
      cs.shape === "round"
        ? "⌀" + fmt(cs.d) + (cs.end_d && cs.end_d !== cs.d ? "→" + fmt(cs.end_d) : "")
        : fmt(cs.w) +
          " x " +
          fmt(cs.t) +
          (cs.shape === "rect" && cs.end_w
            ? "→" + fmt(cs.end_w) + " x " + fmt(cs.end_t || cs.t)
            : "");
    return fmt(L) + " x " + sec;
  }
  const d = [pl.sx, pl.sy, pl.sz].sort((m, n) => n - m);
  if (part.profile?.type === "circle" && Math.abs(d[0] - d[1]) < 1)
    return "⌀" + fmt(d[0]) + " x " + fmt(d[2]);
  return `${fmt(d[0])} x ${fmt(d[1])} x ${fmt(d[2])}`;
}
function partCut(part: Part, fmt: (mm: number) => string) {
  if (part.source === "buy") return "BUY";
  const pl = part.placements[0];
  if (isAxisPlacement(pl)) {
    const d = norm(sub(pl.to, pl.from)),
      off = (Math.acos(Math.min(1, Math.abs(d[1]))) * 180) / Math.PI;
    if (part.ends === "level" && off > 0.5) return `ENDS ${off.toFixed(1)}° LEVEL`;
    const cs = part.cross_section;
    const tapered = cs && (cs.shape === "round" ? cs.end_d : cs.end_w);
    return tapered ? "TAPER" : "SQUARE";
  }
  const t = part.profile?.type;
  const cuts: Partial<Record<NonNullable<typeof t>, string>> = {
    circle: "CIRCLE",
    ellipse: "OVAL",
    rounded_rect:
      "R" +
      fmt(part.profile?.type === "rounded_rect" ? part.profile.radius : 0) +
      " CORNERS",
    path: "SHAPED, SEE VIEW",
  };
  return (t && cuts[t]) || "SQUARE";
}

export function renderBlueprint(plan: Plan, units: Units, highlightPartId?: string): string {
  const fmt = (mm: number) => formatDimension(mm, units);
  const solids = solidsOf(plan),
    B = bounds(solids);
  const W = B.hi[0] - B.lo[0],
    H = B.hi[1] - B.lo[1],
    D = B.hi[2] - B.lo[2];
  const views = {
    front: drawView(solids, "front", highlightPartId),
    top: drawView(solids, "top", highlightPartId),
    side: drawView(solids, "side", highlightPartId),
    iso: drawView(solids, "iso", highlightPartId),
  };

  const marginL = 110,
    marginT = 70,
    gap = 90;
  const s = Math.min(
    (600 - marginL - gap - 60) / (W + D),
    (SHEET_H - marginT - gap - 110) / (H + D),
    1.2
  );
  const topX = marginL,
    topY = marginT,
    frontX = marginL,
    frontY = topY + D * s + gap,
    sideX = frontX + W * s + gap,
    sideY = frontY;

  let svg = `<svg viewBox="0 0 ${SHEET_W} ${SHEET_H}" xmlns="http://www.w3.org/2000/svg" font-family="Courier New, monospace">
  <defs>
    <pattern id="g1" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="var(--grid)" stroke-width="1"/></pattern>
    <pattern id="g2" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#g1)"/><path d="M50 0H0V50" fill="none" stroke="var(--grid-major)" stroke-width="1"/></pattern>
    <marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 2L10 5L0 8Z" fill="var(--line)"/></marker>
    <style>
      svg { --bp: #0b4f9c; --line: #eaf3ff; --grid: rgba(255,255,255,0.08); --grid-major: rgba(255,255,255,0.16); }
      .vis { fill: none; stroke: var(--line); stroke-width: 1.4; stroke-linejoin: round; stroke-linecap: round; }
      .hlt { fill: none; stroke: #ffb020; stroke-width: 2.6; stroke-linejoin: round; stroke-linecap: round; }
      .hid { fill: none; stroke: var(--line); stroke-width: .8; stroke-dasharray: 5 4; opacity: .45; }
      .ext { stroke: var(--line); stroke-width: .7; stroke-dasharray: 3 3; opacity: .75; }
      .dim { stroke: var(--line); stroke-width: .9; }
      .lbl { fill: var(--line); font-size: 13px; }
      .th  { fill: var(--line); font-size: 12px; letter-spacing: 1px; }
      .ttl { fill: var(--line); font-size: 13px; letter-spacing: 2px; }
      .big { fill: var(--line); font-size: 20px; letter-spacing: 3px; }
    </style>
  </defs>
  <rect width="${SHEET_W}" height="${SHEET_H}" fill="var(--bp)"/><rect width="${SHEET_W}" height="${SHEET_H}" fill="url(#g2)"/>
  <rect x="16" y="16" width="${SHEET_W - 32}" height="${SHEET_H - 32}" fill="none" stroke="var(--line)" stroke-width="2"/>`;

  const top = placeView(views.top, topX, topY, s),
    front = placeView(views.front, frontX, frontY, s),
    side = placeView(views.side, sideX, sideY, s);
  svg += top.svg + front.svg + side.svg;

  // isometric (visible edges only)
  const iso = views.iso,
    iw = iso.box.u1 - iso.box.u0,
    ih = iso.box.v1 - iso.box.v0;
  const R = { x0: 660, y0: 50, x1: SHEET_W - 50, y1: 400 },
    k = Math.min((R.x1 - R.x0) / iw, (R.y1 - R.y0) / ih);
  const isoV = placeView(
    { ...iso, hidden: [] },
    R.x0 + (R.x1 - R.x0 - iw * k) / 2,
    R.y0 + (R.y1 - R.y0 - ih * k) / 2,
    k
  );
  svg += isoV.svg + `<text x="${(R.x0 + R.x1) / 2}" y="428" text-anchor="middle" class="ttl">ISOMETRIC VIEW</text>`;

  svg += `<text x="${topX + (W * s) / 2}" y="${topY - 14}" text-anchor="middle" class="ttl">TOP VIEW</text>
    <text x="${frontX + (W * s) / 2}" y="${frontY + H * s + 72}" text-anchor="middle" class="ttl">FRONT VIEW</text>
    <text x="${sideX + (D * s) / 2}" y="${sideY + H * s + 72}" text-anchor="middle" class="ttl">SIDE VIEW</text>`;

  // overall dimensions (measured from the actual geometry)
  svg += dimH(frontX, frontX + W * s, frontY + H * s + 36, frontY + H * s + 4, fmt(W));
  svg += dimV(sideY, sideY + H * s, sideX + D * s + 40, sideX + D * s + 4, fmt(H), -1);
  svg += dimH(sideX, sideX + D * s, sideY + H * s + 36, sideY + H * s + 4, fmt(D));

  // shelf spacing chain (flat horizontal box parts that span most of the width)
  const levels = [B.lo[1], B.hi[1]];
  solids.forEach(({ placement: pl }) => {
    if (!isAxisPlacement(pl) && pl.sy < pl.sx / 4 && pl.sy < pl.sz / 4 && pl.sx > W * 0.6)
      levels.push(pl.y + pl.sy);
  });
  const uniq = [...new Set(levels.map((v) => Math.round(v)))].sort((a, b) => a - b);
  if (uniq.length > 2)
    for (let i = 0; i < uniq.length - 1; i++) {
      const y1 = frontY + (B.hi[1] - uniq[i + 1]) * s,
        y2 = frontY + (B.hi[1] - uniq[i]) * s;
      if (y2 - y1 >= 14)
        svg += dimV(y1, y2, frontX - 40, frontX - 4, fmt(uniq[i + 1] - uniq[i]), 1);
    }

  // angle marks for angled members (left-most copy in the front view,
  // front-most in the side view)
  plan.parts
    .filter((p) => p.placements[0] && isAxisPlacement(p.placements[0]))
    .forEach((p) => {
      const pls = p.placements.filter(isAxisPlacement);
      const lowHigh = (pl: AxisPlacement): [Vec3, Vec3] =>
        pl.from[1] < pl.to[1] ? [pl.from, pl.to] : [pl.to, pl.from];
      const left = [...pls].sort(
        (a, b) => Math.min(a.from[0], a.to[0]) - Math.min(b.from[0], b.to[0])
      )[0];
      const [lo1, hi1] = lowHigh(left);
      svg += angleMark(front.T, VIEWS.front.P, lo1, hi1);
      const near = [...pls].sort(
        (a, b) => Math.min(a.from[2], a.to[2]) - Math.min(b.from[2], b.to[2])
      )[0];
      const [lo2, hi2] = lowHigh(near);
      svg += angleMark(side.T, VIEWS.side.P, lo2, hi2);
    });

  // joint callouts: circled Jn at each part-pair contact centroid (front view)
  {
    const byId = new Map(plan.parts.map((p) => [p.id, p]));
    const MM_TOL = 1;
    const aabbOf = (s: Solid) => {
      const lo: Vec3 = [Infinity, Infinity, Infinity],
        hi: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const v of s.mesh.verts)
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], v[i]);
          hi[i] = Math.max(hi[i], v[i]);
        }
      return { lo, hi };
    };
    const boxes = solids.map(aabbOf);
    for (const j of plan.joints ?? []) {
      if (!byId.has(j.part_a) || !byId.has(j.part_b)) continue; // FLOOR/WALL
      let n = 0;
      for (const [i, sA] of solids.entries()) {
        if (sA.part.id !== j.part_a) continue;
        for (const [k, sB] of solids.entries()) {
          if (sB.part.id !== j.part_b) continue;
          const a = boxes[i],
            b = boxes[k];
          const touch =
            a.lo[0] <= b.hi[0] + MM_TOL &&
            a.hi[0] >= b.lo[0] - MM_TOL &&
            a.lo[1] <= b.hi[1] + MM_TOL &&
            a.hi[1] >= b.lo[1] - MM_TOL &&
            a.lo[2] <= b.hi[2] + MM_TOL &&
            a.hi[2] >= b.lo[2] - MM_TOL;
          if (!touch) continue;
          n++;
          if (n > 3) break; // cap labels: first 3 occurrences get markers
          // contact centroid = midpoint of the AABB overlap region
          const c: Vec3 = [
            (Math.max(a.lo[0], b.lo[0]) + Math.min(a.hi[0], b.hi[0])) / 2,
            (Math.max(a.lo[1], b.lo[1]) + Math.min(a.hi[1], b.hi[1])) / 2,
            (Math.max(a.lo[2], b.lo[2]) + Math.min(a.hi[2], b.hi[2])) / 2,
          ];
          const [ux, uy] = front.T(VIEWS.front.P(c));
          svg += `<circle cx="${r1(ux)}" cy="${r1(uy)}" r="8" class="dim" fill="var(--bp)"/>` +
            `<text x="${r1(ux)}" y="${r1(uy + 4)}" text-anchor="middle" class="lbl" style="font-size:10px">${esc(j.id)}</text>`;
        }
      }
    }
  }

  // diameter / radius callouts in the top view
  solids.forEach(({ part, placement: pl, copy }) => {
    if (copy || isAxisPlacement(pl) || !part.profile) return;
    const t = part.profile.type;
    if (t !== "circle" && t !== "rounded_rect") return;
    const size: Record<"x" | "y" | "z", number> = { x: pl.sx, y: pl.sy, z: pl.sz };
    const [ua, va] = boxAxes(pl),
      L = size[ua],
      Wd = size[va];
    if (ua === "y" || va === "y") return; // only flat (horizontal) shaped parts are true-shape from the top
    const c: Vec3 = [pl.x + pl.sx / 2, pl.y + pl.sy, pl.z + pl.sz / 2];
    const edge: Vec3 =
      t === "circle"
        ? add(c, [
            Math.cos(Math.PI / 4) * (L / 2),
            0,
            -Math.sin(Math.PI / 4) * (Wd / 2),
          ])
        : [pl.x + pl.sx, pl.y + pl.sy, pl.z];
    const e = top.T(VIEWS.top.P(edge)),
      lx = e[0] + 40,
      ly = e[1] - 26;
    const label =
      t === "circle"
        ? Math.abs(L - Wd) < 1
          ? "⌀" + fmt(L)
          : fmt(L) + " x " + fmt(Wd) + " OVAL"
        : "R" + fmt(part.profile.radius) + " TYP.";
    svg += `<line x1="${r1(e[0])}" y1="${r1(e[1])}" x2="${r1(lx)}" y2="${r1(ly)}" class="dim" marker-start="url(#a)"/>
      <line x1="${r1(lx)}" y1="${r1(ly)}" x2="${r1(lx + 18)}" y2="${r1(ly)}" class="dim"/>
      <text x="${r1(lx + 22)}" y="${r1(ly + 4)}" class="lbl">${label}</text>`;
  });

  // parts table: columns sized to their content; font shrinks if needed so
  // nothing overflows
  const rows = plan.parts.map((p) => [
    p.id,
    p.name.toUpperCase(),
    String(p.placements.length),
    partSize(p, fmt),
    partCut(p, fmt),
  ]);
  const head = ["ID", "PART", "QTY", "SIZE", "CUT"],
    tx = 620,
    tw = SHEET_W - 16 - tx,
    ty = 462;
  const chars = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fs = Math.min(
    12,
    (tw - 14 * head.length) / (0.62 * chars.reduce((a, b) => a + b, 0))
  );
  const colW = chars.map((c) => c * 0.62 * fs + 14),
    extra = (tw - colW.reduce((a, b) => a + b, 0)) / head.length;
  const colX: number[] = [];
  colW.reduce((x, w) => (colX.push(x), x + w + extra), 0);
  const rowH = Math.max(18, fs + 10),
    th = rowH * (rows.length + 1);
  svg += `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="var(--bp)" stroke="var(--line)" stroke-width="1.5"/>`;
  [head, ...rows].forEach((r, ri) => {
    const ry = ty + rowH * ri;
    if (ri) {
      svg += `<line x1="${tx}" y1="${ry}" x2="${tx + tw}" y2="${ry}" stroke="var(--line)" stroke-width=".7"/>`;
      if (plan.parts[ri - 1]?.id === highlightPartId)
        svg += `<rect x="${tx}" y="${ry}" width="${tw}" height="${rowH}" fill="#ffb020" opacity="0.18"/>`;
    }
    r.forEach(
      (t, i) =>
        (svg += `<text x="${r1(tx + colX[i] + 7)}" y="${r1(ry + rowH / 2 + fs * 0.35)}" class="th" style="font-size:${fs.toFixed(1)}px;letter-spacing:0">${esc(t)}</text>`)
    );
  });
  colX
    .slice(1)
    .forEach(
      (cx) =>
        (svg += `<line x1="${r1(tx + cx)}" y1="${ty}" x2="${r1(tx + cx)}" y2="${ty + th}" stroke="var(--line)" stroke-width=".7"/>`)
    );

  // title block
  const tbW = 300,
    tbH = 120,
    tbX = SHEET_W - 16 - tbW,
    tbY = SHEET_H - 16 - tbH;
  svg += `<rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" fill="var(--bp)" stroke="var(--line)" stroke-width="2"/>
    <line x1="${tbX}" y1="${tbY + 44}" x2="${tbX + tbW}" y2="${tbY + 44}" stroke="var(--line)"/>
    <line x1="${tbX}" y1="${tbY + 82}" x2="${tbX + tbW}" y2="${tbY + 82}" stroke="var(--line)"/>
    <line x1="${tbX + 150}" y1="${tbY + 44}" x2="${tbX + 150}" y2="${tbY + tbH}" stroke="var(--line)"/>
    <text x="${tbX + 14}" y="${tbY + 29}" class="big" style="font-size:${r1(
      Math.min(20, Math.max(11, (tbW - 24) / (0.62 * Math.max(1, plan.title.length))))
    )}px">${esc(plan.title.toUpperCase())}</text>
    <text x="${tbX + 14}" y="${tbY + 68}" class="lbl">UNITS: ${units === "metric" ? "MM" : "INCHES"}</text>
    <text x="${tbX + 164}" y="${tbY + 68}" class="lbl">SCALE: NTS</text>
    <text x="${tbX + 14}" y="${tbY + 106}" class="lbl">PARTS: ${plan.parts.length}</text>
    <text x="${tbX + 164}" y="${tbY + 106}" class="lbl">SHEET 1 OF 1</text></svg>`;
  return svg;
}
