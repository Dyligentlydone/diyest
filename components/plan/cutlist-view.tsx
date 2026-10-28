"use client";

import { useMemo, useState } from "react";
import { Scissors, SlidersHorizontal } from "lucide-react";
import { computeCutList, DEFAULT_STOCK, stockLabel, type Cut } from "@/lib/plan/cutlist";
import type { Plan } from "@/lib/plan/schema";
import { formatDimension } from "@/lib/units";
import type { Units } from "@/lib/types";

/** Collapse identical cuts on the same stock piece into a single row with count. */
function groupCuts(cuts: Cut[]): (Cut & { count: number })[] {
  const map = new Map<string, Cut & { count: number }>();
  for (const c of cuts) {
    const key = `${c.partId}|${c.length}|${c.width ?? ""}|${c.note ?? ""}`;
    const prev = map.get(key);
    if (prev) prev.count += 1;
    else map.set(key, { ...c, count: 1 });
  }
  return [...map.values()];
}

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
  const [showStockSettings, setShowStockSettings] = useState(false);
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
    `cursor-pointer transition-colors ${selectedPart === id ? "bg-blueprint/15" : "hover:bg-muted/50"}`;

  const pieces = [...cut.boards, ...cut.sheets];
  if (!pieces.length && !cut.loose.length) return null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Scissors className="h-5 w-5" /> Cut list &amp; board layout
          <span className="text-xs font-normal text-muted-foreground">
            ({pieces.length} stock piece{pieces.length === 1 ? "" : "s"})
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setShowStockSettings((v) => !v)}
          className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <SlidersHorizontal className="h-3 w-3" /> Stock sizes (kerf {fmt(kerfMm)})
        </button>
      </div>

      {showStockSettings && (
        <div className="mb-3 flex flex-wrap gap-4 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            Board length ({units === "metric" ? "mm" : "in"}):
            <input
              type="number"
              className="w-20 rounded border bg-background px-1.5 py-0.5"
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
              className="w-20 rounded border bg-background px-1.5 py-0.5"
              value={units === "metric" ? sheet.W : Math.round(sheet.W / 25.4)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) setSheet((s) => ({ ...s, W: units === "metric" ? v : Math.round(v * 25.4) }));
              }}
            />
            ×
            <input
              type="number"
              className="w-20 rounded border bg-background px-1.5 py-0.5"
              value={units === "metric" ? sheet.L : Math.round(sheet.L / 25.4)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) setSheet((s) => ({ ...s, L: units === "metric" ? v : Math.round(v * 25.4) }));
              }}
            />
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {pieces.map((piece, i) => {
          const pct = Math.min(100, Math.round(piece.usedPct * 100));
          const grouped = groupCuts(piece.cuts);
          return (
            <div key={i} className="overflow-hidden rounded-md border bg-card">
              <div className="border-b bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-foreground">
                    #{i + 1} · {stockLabel(piece, units)}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {pct}% used
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-blueprint/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {grouped.map((c, j) => (
                    <tr
                      key={j}
                      className={`border-t first:border-t-0 ${rowCls(c.partId)}`}
                      onClick={() => onPartSelect?.(selectedPart === c.partId ? null : c.partId)}
                    >
                      <td className="py-1.5 pl-3 pr-1.5 font-mono font-semibold">
                        {c.partId}
                        {c.count > 1 && (
                          <span className="ml-1 text-muted-foreground">×{c.count}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        {c.name}
                        {c.note && (
                          <span className="block text-[11px] text-muted-foreground">
                            {c.note}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-muted-foreground">
                        {fmt(c.length)}
                        {c.width ? ` × ${fmt(c.width)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {cut.loose.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Other / custom stock</p>
          <ul className="mt-1 space-y-1">
            {cut.loose.map((l, i) => (
              <li key={i}>
                <span className="font-mono">{l.partId}</span> {l.name} — {l.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
