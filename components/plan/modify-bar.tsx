"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  DollarSign,
  Move,
  Paintbrush,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Plan } from "@/lib/plan/schema";
import { toMm } from "@/lib/units";
import type { Units } from "@/lib/types";

export interface ModifyResult {
  plan: Plan;
  unverified: string[];
  blockers: string[];
  warnings: string[];
  reviewPending: boolean;
  changedSteps: number[];
  usage?: { used: number; remaining: number; limit: number };
}

const STYLES = [
  { key: "rustic", label: "Rustic" },
  { key: "modern", label: "Modern" },
  { key: "scandinavian", label: "Scandinavian" },
  { key: "industrial", label: "Industrial" },
  { key: "farmhouse", label: "Farmhouse" },
] as const;

type Kind = "fit_space" | "cheaper" | "upgrade" | "restyle" | "custom";

export function ModifyBar({
  plan,
  units,
  projectId,
  disabled,
  onModified,
}: {
  plan: Plan;
  units: Units;
  projectId?: string | null;
  disabled?: boolean;
  onModified: (r: ModifyResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [fitOpen, setFitOpen] = useState(false);
  const [custom, setCustom] = useState("");

  async function apply(kind: Kind, extra: Record<string, unknown> = {}) {
    setBusy(kind);
    try {
      const res = await fetch("/api/modify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan,
          kind,
          units,
          projectId: projectId ?? undefined,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Modify failed");
      onModified(data as ModifyResult);
      setOpen(false);
      setFitOpen(false);
      setCustom("");
      if (data.usage?.remaining === 0)
        toast.info("That was your last modification on this plan.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function submitFit(fd: FormData) {
    const n = (k: string) => {
      const v = Number(fd.get(k));
      return Number.isFinite(v) && v > 0 ? toMm(v, units) : undefined;
    };
    void apply("fit_space", {
      dims: { width: n("m_width"), depth: n("m_depth"), height: n("m_height") },
    });
  }

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Wand2 className="h-4 w-4" /> Change this plan
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy != null}
              onClick={() => setFitOpen((o) => !o)}
            >
              <Move className="mr-1.5 h-3.5 w-3.5" /> Fit my space
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy != null}
              onClick={() => apply("cheaper")}
            >
              <DollarSign className="mr-1.5 h-3.5 w-3.5" />
              {busy === "cheaper" ? "Working…" : "Make it cheaper"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy != null}
              onClick={() => apply("upgrade")}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {busy === "upgrade" ? "Working…" : "Upgrade it"}
            </Button>
            {STYLES.map((s) => (
              <Button
                key={s.key}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || busy != null}
                onClick={() => apply("restyle", { style: s.key })}
              >
                <Paintbrush className="mr-1.5 h-3.5 w-3.5" />
                {busy === "restyle" ? "Working…" : s.label}
              </Button>
            ))}
          </div>

          {fitOpen && (
            <form
              className="flex flex-wrap items-end gap-2 rounded-md bg-muted/50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitFit(new FormData(e.currentTarget));
              }}
            >
              {(["m_width", "m_depth", "m_height"] as const).map((k) => (
                <div key={k} className="space-y-1">
                  <label
                    htmlFor={k}
                    className="block text-xs capitalize text-muted-foreground"
                  >
                    {k.slice(2)} ({units === "metric" ? "mm" : "in"})
                  </label>
                  <Input
                    id={k}
                    name={k}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    className="h-8 w-24"
                  />
                </div>
              ))}
              <Button type="submit" size="sm" disabled={busy != null}>
                {busy === "fit_space" ? "Working…" : "Fit it"}
              </Button>
            </form>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) void apply("custom", { text: custom.trim() });
            }}
          >
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder='Or describe a change — "add a drawer", "make it wider"…'
              className="h-8 text-sm"
              maxLength={1000}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={disabled || busy != null || !custom.trim()}
            >
              {busy === "custom" ? "Working…" : "Apply"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">
            Every change is re-checked by the carpenter review before you see it.
            {disabled && " Available once the current review finishes."}
          </p>
        </div>
      )}
    </div>
  );
}
