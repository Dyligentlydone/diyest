/**
 * Cut-list optimizer — pure code, no AI (BRIEF-v2 §3 principle 1/2).
 *
 * Turns plan parts into a buy list of stock pieces plus the cuts to make on
 * each. Boards and dowels pack in 1D (first-fit decreasing into stock
 * lengths); sheet goods pack in 2D (shelf packing with kerf). Bought parts
 * are excluded; shaped (profiled) parts use their bounding rectangle with a
 * "shape inside" note; angled members report their true end-cut angle.
 */
import type { Part, Plan } from "./schema";
import { isAxisPlacement } from "./schema";
import { len, norm, sub } from "@/lib/blueprint/solids";
import { formatDimension } from "@/lib/units";
import type { Units } from "@/lib/types";

export interface Cut {
  partId: string;
  name: string;
  length: number; // mm — 1D: cut length; 2D: rect length on sheet
  width?: number; // mm — 2D only
  note?: string; // e.g. "ends level at 8.2°", "round profile — trace shape"
}

/**
 * Strip leading thickness/dimension prefixes ("25 mm birch plywood") and
 * trailing finish notes (", walnut-stained", ", black-painted") from a part's
 * material string so identical raw stock packs together and stockLabel never
 * repeats "25 mm 25 mm ...".
 */
export function cleanStockMaterial(raw: string): string {
  return raw
    .trim()
    .replace(/^\d+([./]\d+)?\s*(mm|cm|in|inch|inches|")\s+/i, "")
    .replace(
      /,\s*[^,]*(stained|painted|finished|primed|coated|lacquered|oiled|varnished|sealed|dyed|clear)[^,]*$/i,
      ""
    )
    .trim();
}

/** Unit-aware stock label: `¾" × 11¼" × 94½" pine` / "19×286×2400 mm …" */
export function stockLabel(p: StockPiece, units: Units): string {
  // stock is sold in nominal sizes — snap to a whole inch only when within
  // ~2mm of one (1220→48″), otherwise keep 1/16″ precision (19mm→¾″)
  const f = (mm: number) => {
    const snapped =
      units === "imperial" &&
      Math.abs(mm - Math.round(mm / 25.4) * 25.4) <= 2
        ? Math.round(mm / 25.4) * 25.4
        : mm;
    return formatDimension(snapped, units);
  };
  const u = units === "metric" ? " mm" : "";
  const cleaned = cleanStockMaterial(p.material);
  const mat = cleaned.toLowerCase().endsWith(p.kind)
    ? cleaned
    : `${cleaned} ${p.kind}`;
  if (p.kind === "sheet")
    return `${f(p.width ?? 0)} × ${f(p.length)} × ${f(p.thickness ?? 0)}${u} ${mat}`;
  if (p.sectionMm && "d" in p.sectionMm)
    return `⌀${f(p.sectionMm.d)} × ${f(p.length)}${u} ${mat}`;
  if (p.sectionMm)
    return `${f(p.sectionMm.t)} × ${f(p.sectionMm.w)} × ${f(p.length)}${u} ${mat}`;
  return `${f(p.length)}${u} ${mat}`;
}

export interface StockPiece {
  /** e.g. "19×89×2400 mm pine board" or "1220×2440×18 mm plywood sheet" */
  label: string;
  material: string;
  length: number;
  width?: number; // sheets only
  thickness?: number;
  kind: "board" | "dowel" | "sheet";
  /** board/dowel cross-section for unit-aware labels */
  sectionMm?: { w: number; t: number } | { d: number };
  cuts: Cut[];
  /** fraction of stock used (length for 1D, area for 2D) */
  usedPct: number;
  /** rough USD estimate — ballpark, flagged "est." in the UI */
  estUsd?: number;
}

export interface CutList {
  boards: StockPiece[];
  sheets: StockPiece[];
  /** stock "other" — can't be optimized (turned, bent, found material) */
  loose: { partId: string; name: string; note: string }[];
}

/** Default stock the optimizer buys — user-editable in the UI. */
export interface StockConfig {
  boardLengths: number[]; // mm, tried large→small, fewest boards wins
  sheetL: number;
  sheetW: number;
  dowelLengths: number[];
}

export const DEFAULT_STOCK: StockConfig = {
  boardLengths: [2400, 1800, 1200],
  sheetL: 2440,
  sheetW: 1220,
  dowelLengths: [900, 600],
};

interface Piece {
  partId: string;
  name: string;
  L: number;
  W?: number; // sheet pieces only
  note?: string;
  key: string; // stock group: material + section
}

/** End-cut angle for an angled member ("level" ends), degrees from square. */
function endAngle(part: Part): number | null {
  const pl = part.placements[0];
  if (!pl || !isAxisPlacement(pl) || part.ends !== "level") return null;
  const d = norm(sub(pl.to, pl.from));
  const off = (Math.acos(Math.min(1, Math.abs(d[1]))) * 180) / Math.PI;
  return off > 0.5 ? off : null;
}

function fmtSection(w: number, t: number): string {
  return `${Math.round(Math.min(w, t))}×${Math.round(Math.max(w, t))}`;
}

/** Split a plan's make-parts into 1D (board/dowel) and 2D (sheet) pieces. */
function piecesOf(plan: Plan): {
  boards: Map<string, Piece[]>; // key: `${material}|${section}`
  sheets: Map<string, Piece[]>; // key: `${material}|${thickness}`
  loose: CutList["loose"];
} {
  const boards = new Map<string, Piece[]>();
  const sheets = new Map<string, Piece[]>();
  const loose: CutList["loose"] = [];
  const push = (m: Map<string, Piece[]>, p: Piece) => {
    const a = m.get(p.key) ?? [];
    a.push(p);
    m.set(p.key, a);
  };

  for (const part of plan.parts) {
    if (part.source === "buy") continue;
    const pl = part.placements[0];
    if (!pl) continue;
    const shaped = !!part.profile && part.profile.type !== "rect";
    const shapedNote = shaped ? `${part.profile!.type} profile — trace shape inside` : undefined;

    if (isAxisPlacement(pl)) {
      // legs / braces / dowels: length along the member axis
      const L = len(sub(pl.to, pl.from));
      const cs = part.cross_section;
      const isRound = cs?.shape === "round" || part.stock === "dowel";
      const ang = endAngle(part);
      const notes = [
        shapedNote,
        cs && (cs.shape === "round" ? cs.end_d : cs?.end_w) ? "tapered" : null,
        ang ? `ends level at ${ang.toFixed(1)}°` : null,
      ].filter(Boolean) as string[];
      const section = isRound
        ? `⌀${Math.round(cs?.shape === "round" ? cs.d : part.thickness_mm)}`
        : fmtSection(
            cs?.shape === "rect" ? cs.w : part.width_mm,
            cs?.shape === "rect" ? cs.t : part.thickness_mm
          );
      const key = `${cleanStockMaterial(part.material)}|${section}`;
      for (let i = 0; i < part.qty; i++)
        push(boards, {
          partId: part.id,
          name: part.name,
          L,
          note: notes.join("; ") || undefined,
          key,
        });
      continue;
    }

    // box placement: two largest face dims are the piece footprint
    const dims = [pl.sx, pl.sy, pl.sz].sort((a, b) => b - a);
    if (part.stock === "sheet") {
      const key = `${cleanStockMaterial(part.material)}|${Math.round(part.thickness_mm)}`;
      for (let i = 0; i < part.qty; i++)
        push(sheets, {
          partId: part.id,
          name: part.name,
          L: dims[0],
          W: dims[1],
          note: shapedNote,
          key,
        });
    } else if (part.stock === "dowel" || part.stock === "board" || part.stock === "other") {
      if (part.stock === "other") {
        loose.push({
          partId: part.id,
          name: part.name,
          note: part.notes ?? "cut from material as noted",
        });
        continue;
      }
      const key = `${cleanStockMaterial(part.material)}|${fmtSection(part.width_mm, part.thickness_mm)}`;
      for (let i = 0; i < part.qty; i++)
        push(boards, {
          partId: part.id,
          name: part.name,
          L: dims[0],
          note: shapedNote,
          key,
        });
    }
  }
  return { boards, sheets, loose };
}

/** First-fit decreasing into equal-length stock. Fewest pieces wins. */
function pack1D(pieces: Piece[], stockLen: number, kerf: number): Cut[][] | null {
  const bins: { rem: number; cuts: Cut[] }[] = [];
  for (const p of [...pieces].sort((a, b) => b.L - a.L)) {
    if (p.L > stockLen) return null; // doesn't fit this stock at all
    let placed = false;
    for (const b of bins) {
      const need = p.L + (b.cuts.length ? kerf : 0);
      if (need <= b.rem) {
        b.cuts.push({ partId: p.partId, name: p.name, length: p.L, note: p.note });
        b.rem -= need;
        placed = true;
        break;
      }
    }
    if (!placed)
      bins.push({ rem: stockLen - p.L, cuts: [{ partId: p.partId, name: p.name, length: p.L, note: p.note }] });
  }
  return bins.map((b) => b.cuts);
}

/** Shelf packing: rows of pieces stacked along sheet length, kerf between. */
function pack2D(
  pieces: Piece[],
  sheetL: number,
  sheetW: number,
  kerf: number
): { L: number; W: number; cuts: Cut[] }[] {
  const sorted = [...pieces].sort((a, b) => (b.W ?? 0) - (a.W ?? 0));
  const sheets: { L: number; W: number; cuts: Cut[] }[] = [];
  let cur: { L: number; W: number; cuts: Cut[] } | null = null;
  let x = 0,
    y = 0,
    rowH = 0;

  const newSheet = () => {
    cur = { L: sheetL, W: sheetW, cuts: [] };
    sheets.push(cur);
    x = 0;
    y = 0;
    rowH = 0;
  };
  newSheet();

  for (const p of sorted) {
    const w = p.W ?? 0,
      l = p.L;
    const tryPlace = () => {
      if (x > 0 && x + w > sheetW) return false; // doesn't fit this row
      cur!.cuts.push({ partId: p.partId, name: p.name, length: l, width: w, note: p.note });
      x += w + kerf;
      rowH = Math.max(rowH, l);
      return true;
    };
    if (x + w <= sheetW && tryPlace()) continue;
    // new row
    y += rowH + kerf;
    x = 0;
    rowH = 0;
    if (y + l <= sheetL && tryPlace()) continue;
    // new sheet
    newSheet();
    if (!tryPlace()) {
      // still can't place — piece bigger than the sheet; park it as its own
      cur!.cuts.push({
        partId: p.partId,
        name: `${p.name} (larger than sheet — check stock!)`,
        length: l,
        width: w,
        note: p.note,
      });
    }
  }
  return sheets;
}

/** Rough per-stock estimate — ballpark only (labeled "est." in the UI). */
function estBoardUsd(mat: string, L: number): number {
  const hardwood = /oak|walnut|maple|cherry|ash|mahogany/i.test(mat);
  return Math.round((hardwood ? 14 : 7) * (L / 2400) * 100) / 100;
}
function estSheetUsd(mat: string): number {
  return /oak|walnut|maple|birch/i.test(mat) ? 85 : 55;
}
function estDowelUsd(): number {
  return 4;
}

/** Main entry: plan + kerf + stock config → boards to buy with their cuts. */
export function computeCutList(
  plan: Plan,
  { kerfMm = 3, stock = DEFAULT_STOCK }: { kerfMm?: number; stock?: StockConfig } = {}
): CutList {
  const { boards, sheets, loose } = piecesOf(plan);
  const out: CutList = { boards: [], sheets: [], loose };

  for (const [key, pieces] of boards) {
    const [material, section] = key.split("|");
    const isDowel = section.startsWith("⌀");
    const lengths = (isDowel ? stock.dowelLengths : stock.boardLengths)
      .slice()
      .sort((a, b) => b - a);
    // choose the stock length with fewest pieces; tie → least total waste
    let best: { bins: Cut[][]; L: number; waste: number } | null = null;
    for (const L of lengths) {
      const bins = pack1D(pieces, L, kerfMm);
      if (!bins) continue;
      const waste = bins.length * L - pieces.reduce((s, p) => s + p.L, 0);
      if (
        !best ||
        bins.length < best.bins.length ||
        (bins.length === best.bins.length && waste < best.waste)
      )
        best = { bins, L, waste };
    }
    if (!best) {
      // nothing fits any stock — each piece parks on its own line
      pieces.forEach((p) =>
        loose.push({
          partId: p.partId,
          name: p.name,
          note: `${Math.round(p.L)} mm ${section} ${material} — longer than standard stock`,
        })
      );
      continue;
    }
    const secMatch = section.match(/^(\d+)×(\d+)$/) ?? section.match(/^⌀(\d+)$/);
    const sectionMm = secMatch
      ? secMatch[2]
        ? { t: Number(secMatch[1]), w: Number(secMatch[2]) }
        : { d: Number(secMatch[1]) }
      : undefined;
    for (const cuts of best.bins) {
      const used = cuts.reduce((s, c) => s + c.length, 0);
      out.boards.push({
        label: `${section}×${best.L} mm ${material} ${isDowel ? "dowel" : "board"}`,
        material,
        length: best.L,
        kind: isDowel ? "dowel" : "board",
        sectionMm,
        cuts,
        usedPct: used / best.L,
        estUsd: isDowel ? estDowelUsd() : estBoardUsd(material, best.L),
      });
    }
  }

  for (const [key, pieces] of sheets) {
    const [material, thickness] = key.split("|");
    const packed = pack2D(pieces, stock.sheetL, stock.sheetW, kerfMm);
    for (const sh of packed) {
      const used = sh.cuts.reduce((s, c) => s + c.length * (c.width ?? 0), 0);
      out.sheets.push({
        label: `${stock.sheetW}×${stock.sheetL}×${thickness} mm ${material} sheet`,
        material,
        length: stock.sheetL,
        width: stock.sheetW,
        thickness: Number(thickness),
        kind: "sheet",
        cuts: sh.cuts,
        usedPct: used / (stock.sheetL * stock.sheetW),
        estUsd: estSheetUsd(material),
      });
    }
  }

  return out;
}
