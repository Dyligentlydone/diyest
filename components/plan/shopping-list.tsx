"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ClipboardCopy, Printer, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { buildShoppingList, shoppingListText } from "@/lib/plan/shopping";
import { computeCutList } from "@/lib/plan/cutlist";
import type { Plan } from "@/lib/plan/schema";
import type { Units } from "@/lib/types";

const HAVE_KEY = "diyest_shopping_have";
const EMPTY = new Set<string>();
const listeners = new Set<() => void>();
let localCache: Set<string> | null = null;

function getLocal(): Set<string> {
  if (!localCache) {
    try {
      localCache = new Set(
        JSON.parse(localStorage.getItem(HAVE_KEY) ?? "[]") as string[]
      );
    } catch {
      localCache = new Set();
    }
  }
  return localCache;
}

function subscribeLocal(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function saveHaveLocal(keys: Set<string>) {
  localCache = keys;
  try {
    localStorage.setItem(HAVE_KEY, JSON.stringify([...keys]));
  } catch {
    /* storage full/blocked — session-only marks */
  }
  listeners.forEach((cb) => cb());
}

/**
 * Grouped shopping list with "already have" checkboxes and copy/print.
 * Pre-login marks live in localStorage; when a saved project id is present
 * the server is the source of truth and local marks are merged in once.
 */
export function ShoppingList({
  plan,
  units = "metric",
  kerfMm = 3,
  projectId,
  serverHave = [],
  excludeMaterials = [],
}: {
  plan: Plan;
  units?: Units;
  kerfMm?: number;
  /** saved project → marks persist server-side */
  projectId?: string | null;
  serverHave?: string[];
  /** leftovers mode — materials the user already has */
  excludeMaterials?: string[];
}) {
  const list = useMemo(
    () =>
      buildShoppingList(
        plan,
        computeCutList(plan, { kerfMm }),
        units,
        excludeMaterials
      ),
    [plan, kerfMm, units, excludeMaterials]
  );
  const validKeys = useMemo(
    () => new Set(list.sections.flatMap((s) => s.items.map((i) => i.key))),
    [list]
  );
  // server-side marks (saved projects) + device-local marks (pre-login cache)
  const [have, setHave] = useState<Set<string>>(() => new Set(serverHave));
  const local = useSyncExternalStore(subscribeLocal, getLocal, () => EMPTY);
  const shownHave = useMemo(
    () => new Set([...have, ...local].filter((k) => validKeys.has(k))),
    [have, local, validKeys]
  );

  // on a saved project, push the union of server+local marks up once —
  // local stays as a device cache (harmless duplicates, validKeys-filtered)
  const mergedRef = useRef(false);
  useEffect(() => {
    if (!projectId || mergedRef.current) return;
    mergedRef.current = true;
    const merged = [...new Set([...serverHave, ...local])].filter((k) =>
      validKeys.has(k)
    );
    const newKeys = merged.filter((k) => !serverHave.includes(k));
    if (!newKeys.length) return;
    void fetch(`/api/projects/${projectId}/have`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: merged }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const currency = plan.est_cost.currency;
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

  function toggle(key: string) {
    const next = new Set(shownHave);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (projectId) {
      setHave(next);
      void fetch(`/api/projects/${projectId}/have`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: [...next] }),
      }).catch(() => {});
    } else {
      saveHaveLocal(next);
    }
  }

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
                    aria-label={shownHave.has(i.key) ? "Mark as needed" : "Mark as already have"}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      shownHave.has(i.key) ? "border-blueprint bg-blueprint text-blueprint-foreground" : ""
                    }`}
                  >
                    {shownHave.has(i.key) && <Check className="h-3 w-3" />}
                  </button>
                  <span className={shownHave.has(i.key) ? "text-muted-foreground line-through" : ""}>
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
          Estimated materials total: <strong>~{money(list.estTotalUsd)}</strong>
          <span className="ml-2 text-xs text-muted-foreground">
            rough estimate — check your local prices
          </span>
        </p>
      </div>
    </section>
  );
}
