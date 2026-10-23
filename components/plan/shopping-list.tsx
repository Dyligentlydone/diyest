"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardCopy, Printer, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { buildShoppingList, shoppingListText } from "@/lib/plan/shopping";
import { computeCutList } from "@/lib/plan/cutlist";
import type { Plan } from "@/lib/plan/schema";
import type { Units } from "@/lib/types";

const HAVE_KEY = "diyest_shopping_have";

function loadHave(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HAVE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Grouped shopping list with "already have" checkboxes and copy/print. */
export function ShoppingList({
  plan,
  units = "metric",
  kerfMm = 3,
}: {
  plan: Plan;
  units?: Units;
  kerfMm?: number;
}) {
  const list = useMemo(
    () => buildShoppingList(plan, computeCutList(plan, { kerfMm }), units),
    [plan, kerfMm, units]
  );
  const [have, setHave] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : loadHave()
  );
  const currency = plan.est_cost.currency;
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

  function toggle(key: string) {
    setHave((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(HAVE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const remaining = list.estTotalUsd;
  if (!list.sections.length) return null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShoppingCart className="h-5 w-5" /> Shopping list
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(shoppingListText(list, currency));
              toast.success("Shopping list copied");
            }}
            className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <ClipboardCopy className="h-3 w-3" /> Copy
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Printer className="h-3 w-3" /> Print
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        {list.sections.map((s) => (
          <div key={s.name}>
            <p className="bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {s.name}
            </p>
            <ul>
              {s.items.map((i) => (
                <li
                  key={i.key}
                  className="flex items-center gap-3 border-t px-3 py-2 text-sm"
                >
                  <button
                    onClick={() => toggle(i.key)}
                    aria-label={have.has(i.key) ? "Mark as needed" : "Mark as already have"}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      have.has(i.key) ? "border-primary bg-primary text-primary-foreground" : ""
                    }`}
                  >
                    {have.has(i.key) && <Check className="h-3 w-3" />}
                  </button>
                  <span className={have.has(i.key) ? "text-muted-foreground line-through" : ""}>
                    {i.name}
                    {i.spec && (
                      <span className="block text-xs text-muted-foreground">{i.spec}</span>
                    )}
                  </span>
                  <span className="ml-auto shrink-0 text-right text-xs text-muted-foreground">
                    {i.qty}
                    {i.estUsd != null && (
                      <span className="block">~{money(i.estUsd)} est.</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="border-t bg-muted/40 px-3 py-2 text-sm">
          Estimated materials total: <strong>~{money(remaining)}</strong>
          <span className="ml-2 text-xs text-muted-foreground">
            rough estimate — check your local prices
          </span>
        </p>
      </div>
    </section>
  );
}
