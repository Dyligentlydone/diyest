"use client";

import { useMemo, useState } from "react";
import { Scissors } from "lucide-react";
import { computeCutList, DEFAULT_STOCK, stockLabel } from "@/lib/plan/cutlist";
import type { Plan } from "@/lib/plan/schema";
import { formatDimension } from "@/lib/units";
import type { Units } from "@/lib/types";

/**
 * "Board layout" — the optimizer's stock pieces with the cuts to make on
 * each. Stock sizes are editable; the layout recomputes client-side.
 */
export function CutListView({
  plan,
  units,
  kerfMm = 3,
  onPartSelect,
  selectedPart,
}: {
  plan: Plan;
  units: Units;
  kerfMm?: number;
  onPartSelect?: (id: string | null) => void;
  selectedPart?: string | null;
}) {
  const [boardLen, setBoardLen] = useState(2400);
  const [sheet, setSheet] = useState({ L: DEFAULT_STOCK.sheetL, W: DEFAULT_STOCK.sheetW });
  const fmt = (mm: number) => formatDimension(mm, units);

  const cut = useMemo(
    () =>
      computeCutList(plan, {
        kerfMm,
        stock: { ...DEFAULT_STOCK, boardLengths: [boardLen, 1800, 1200], sheetL: sheet.L, sheetW: sheet.W },
      }),
    [plan, kerfMm, boardLen, sheet]
  );

  const rowCls = (id: string) =>
    `cursor-pointer ${selectedPart === id ? "bg-amber-500/15" : "hover:bg-muted/50"}`;

  if (!cut.boards.length && !cut.sheets.length && !cut.loose.length) return null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Scissors className="h-5 w-5" /> Cut list &amp; board layout
      </h2>

      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          Board length ({units === "metric" ? "mm" : "in"}):
          <input
            type="number"
            className="w-20 rounded border bg-transparent px-1.5 py-0.5"
            value={units === "metric" ? boardLen : Math.round(boardLen / 25.4)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) setBoardLen(units === "metric" ? v : Math.round(v * 25.4));
            }}
          />
        </label>
        <label className="flex items-center gap-1.5">
          Sheet ({units === "metric" ? "mm" : "in"}):
          <input
            type="number"
            className="w-20 rounded border bg-transparent px-1.5 py-0.5"
            value={units === "metric" ? sheet.W : Math.round(sheet.W / 25.4)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) setSheet((s) => ({ ...s, W: units === "metric" ? v : Math.round(v * 25.4) }));
            }}
          />
          ×
          <input
            type="number"
            className="w-20 rounded border bg-transparent px-1.5 py-0.5"
            value={units === "metric" ? sheet.L : Math.round(sheet.L / 25.4)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) setSheet((s) => ({ ...s, L: units === "metric" ? v : Math.round(v * 25.4) }));
            }}
          />
        </label>
        <span>kerf {fmt(kerfMm)}</span>
      </div>

      <div className="space-y-4">
        {[...cut.boards, ...cut.sheets].map((piece, i) => (
          <div key={i} className="overflow-hidden rounded-md border">
            <div className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{stockLabel(piece, units)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {Math.round(piece.usedPct * 100)}% used
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {piece.cuts.map((c, j) => (
                  <tr
                    key={j}
                    className={`border-t ${rowCls(c.partId)}`}
                    onClick={() => onPartSelect?.(selectedPart === c.partId ? null : c.partId)}
                  >
                    <td className="py-1.5 pl-3 pr-2 font-mono text-xs">{c.partId}</td>
                    <td className="py-1.5 pr-2">
                      {c.name}
                      {c.note && (
                        <span className="block text-xs text-muted-foreground">{c.note}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-xs">
                      {fmt(c.length)}
                      {c.width ? ` × ${fmt(c.width)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {cut.loose.length > 0 && (
          <div className="rounded-md border p-3 text-sm">
            <p className="mb-1 font-medium">Cut as noted</p>
            {cut.loose.map((l) => (
              <p key={l.partId} className="text-muted-foreground">
                {l.partId} {l.name} — {l.note}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
