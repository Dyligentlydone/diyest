/**
 * Shop drawings: one detail sheet per part, and full-size (1:1) printable
 * templates for shaped/profiled parts tiled across A4/Letter pages.
 */
import { isAxisPlacement, type Part, type Plan } from "@/lib/plan/schema";
import { formatDimension } from "@/lib/units";
import type { Units } from "@/lib/types";
import { profileLoops, type Vec2 } from "./path";

const r1 = (x: number) => x.toFixed(1);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function partFaceSize(part: Part): { L: number; W: number } {
  const pl = part.placements[0];
  if (pl && !isAxisPlacement(pl)) return { L: pl.sx, W: pl.sz };
  return { L: part.length_mm, W: part.width_mm };
}

/** One detail drawing for a part: face outline (profile-aware) + key dims. */
export function renderPartSheet(
  part: Part,
  qty: number,
  units: Units
): string {
  const fmt = (mm: number) => formatDimension(mm, units);
  const { L, W } = partFaceSize(part);
  const loops = profileLoops(part.profile, L, W);

  const W_PX = 360,
    H_PX = 300,
    pad = 46;
  const k = Math.min((W_PX - pad * 2) / L, (H_PX - pad * 2 - 30) / W);
  const T = ([x, y]: Vec2): Vec2 => [pad + x * k, pad + (W - y) * k];
  const poly = (pts: Vec2[], cls: string) =>
    `<polygon points="${pts.map((q) => T(q).map(r1).join(",")).join(" ")}" class="${cls}"/>`;

  const line = "#1a1a1a";
  const dim =
    (x1: number, x2: number, y: number, label: string) =>
      `<line x1="${r1(x1)}" y1="${r1(y - 8)}" x2="${r1(x1)}" y2="${r1(y + 4)}" stroke="${line}" stroke-width="0.5" stroke-dasharray="2 2"/>
       <line x1="${r1(x2)}" y1="${r1(y - 8)}" x2="${r1(x2)}" y2="${r1(y + 4)}" stroke="${line}" stroke-width="0.5" stroke-dasharray="2 2"/>
       <line x1="${r1(x1)}" y1="${r1(y)}" x2="${r1(x2)}" y2="${r1(y)}" stroke="${line}" stroke-width="0.6" marker-start="url(#pa)" marker-end="url(#pa)"/>
       <text x="${r1((x1 + x2) / 2)}" y="${r1(y - 3)}" text-anchor="middle" font-size="9" fill="${line}">${esc(label)}</text>`;

  const thickness =
    part.placements[0] && !isAxisPlacement(part.placements[0])
      ? part.placements[0].sy
      : part.thickness_mm;

  return `<svg viewBox="0 0 ${W_PX} ${H_PX}" xmlns="http://www.w3.org/2000/svg" font-family="Courier New, monospace">
  <defs><marker id="pa" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 2L10 5L0 8Z" fill="${line}"/></marker>
  <style>.o{fill:none;stroke:${line};stroke-width:1.2}.h{fill:none;stroke:${line};stroke-width:.8;stroke-dasharray:4 3}.t{fill:${line};font-size:10px}</style></defs>
  <rect width="${W_PX}" height="${H_PX}" fill="#fff"/>
  <text x="${pad}" y="22" class="t" font-weight="bold" font-size="13">${esc(part.id)} — ${esc(part.name)}</text>
  <text x="${pad}" y="36" class="t">×${qty} · ${esc(part.material)} · ${fmt(thickness)} thick</text>
  ${poly(loops.outer, "o")}${loops.holes.map((h) => poly(h, "h")).join("")}
  ${dim(pad, pad + L * k, H_PX - 24, fmt(L))}
  <text x="${r1(pad + L * k + 10)}" y="${r1(pad + (W * k) / 2)}" class="t" transform="rotate(-90 ${r1(pad + L * k + 16)} ${r1(pad + (W * k) / 2)})" text-anchor="middle">${esc(fmt(W))}</text>
</svg>`;
}

/* ---------- full-size templates ---------- */

export const PAPER = {
  a4: { w: 210, h: 297, margin: 12 },
  letter: { w: 215.9, h: 279.4, margin: 12 },
} as const;

export interface TemplatePage {
  col: number;
  row: number;
  label: string;
  svg: string;
}

/**
 * Tile a part's profile at 1:1 scale across paper pages. Each page's SVG is
 * sized in real mm (width/height attrs) so a 100%-scale print is true size.
 * Crosshair registration marks sit at tile corners so pages can be aligned.
 */
export function templatePages(
  part: Part,
  paper: keyof typeof PAPER = "a4"
): TemplatePage[] {
  const { L, W } = partFaceSize(part);
  const loops = profileLoops(part.profile, L, W);
  const P = PAPER[paper];
  const usableW = P.w - P.margin * 2,
    usableH = P.h - P.margin * 2;
  const cols = Math.max(1, Math.ceil(L / usableW)),
    rows = Math.max(1, Math.ceil(W / usableH));

  const pages: TemplatePage[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ox = col * usableW,
        oy = row * usableH; // profile coords covered by this page
      // page shows profile rect [ox, ox+usableW] × [oy, oy+usableH] (y up → y down)
      const T = ([x, y]: Vec2): Vec2 => [
        P.margin + (x - ox),
        P.margin + (oy + usableH - y),
      ];
      const clip = `clip-${col}-${row}`;
      const outline = `<g clip-path="url(#${clip})">
          <polygon points="${loops.outer.map((q) => T(q).map(r1).join(",")).join(" ")}" fill="none" stroke="#000" stroke-width="0.4"/>
          ${loops.holes
            .map(
              (h) =>
                `<polygon points="${h.map((q) => T(q).map(r1).join(",")).join(" ")}" fill="none" stroke="#000" stroke-width="0.3" stroke-dasharray="2 1.5"/>`
            )
            .join("")}
        </g>`;
      // registration crosses at the four tile corners
      const marks = [
        [ox, oy],
        [ox + usableW, oy],
        [ox, oy + usableH],
        [ox + usableW, oy + usableH],
      ]
        .map(([x, y]) => {
          const [px, py] = T([x, y]);
          return `<g stroke="#000" stroke-width="0.2">
            <line x1="${r1(px - 4)}" y1="${r1(py)}" x2="${r1(px + 4)}" y2="${r1(py)}"/>
            <line x1="${r1(px)}" y1="${r1(py - 4)}" x2="${r1(px)}" y2="${r1(py + 4)}"/>
            <circle cx="${r1(px)}" cy="${r1(py)}" r="1.6" fill="none"/>
          </g>`;
        })
        .join("");
      const label = `${String.fromCharCode(65 + col)}${row + 1}`;
      const svg = `<svg width="${P.w}mm" height="${P.h}mm" viewBox="0 0 ${P.w} ${P.h}" xmlns="http://www.w3.org/2000/svg">
        <defs><clipPath id="${clip}"><rect x="${P.margin}" y="${P.margin}" width="${usableW}" height="${usableH}"/></clipPath></defs>
        <rect x="0.3" y="0.3" width="${P.w - 0.6}" height="${P.h - 0.6}" fill="#fff" stroke="#ccc" stroke-width="0.2"/>
        <rect x="${P.margin}" y="${P.margin}" width="${usableW}" height="${usableH}" fill="none" stroke="#bbb" stroke-width="0.2" stroke-dasharray="2 2"/>
        ${outline}${marks}
        <text x="${P.margin + 2}" y="${P.margin - 3}" font-family="monospace" font-size="6" fill="#333">${esc(part.id)} ${esc(part.name)} — tile ${label} of ${cols}×${rows} · 1:1 scale</text>
      </svg>`;
      pages.push({ col, row, label, svg });
    }
  }
  return pages;
}

/** Parts that warrant a full-size template (profiled/curved faces). */
export function templatedParts(plan: Plan): Part[] {
  return plan.parts.filter(
    (p) => p.source !== "buy" && p.profile && p.profile.type !== "rect"
  );
}
