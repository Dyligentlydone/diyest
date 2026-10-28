"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Biohazard,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Ear,
  Glasses,
  Hand,
  Play,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlossedText } from "@/components/plan/glossed-text";
import { StuckChat } from "@/components/plan/stuck-chat";
import type { Plan, Ppe } from "@/lib/plan/schema";

const PPE_ICON: Record<Ppe, { icon: typeof Glasses; label: string }> = {
  glasses: { icon: Glasses, label: "safety glasses" },
  hearing: { icon: Ear, label: "hearing protection" },
  mask: { icon: Biohazard, label: "dust mask / respirator" },
  gloves: { icon: Hand, label: "gloves" },
};

function storageKey(projectId: string | null | undefined, plan: Plan) {
  // stable per plan content so a modified plan resets progress
  let h = 0;
  for (const s of plan.steps) h = (h * 31 + s.n * 7 + s.title.length) >>> 0;
  return `diyest_build_${projectId ?? "draft"}_${h}`;
}

function readDone(key: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

export function BuildMode({
  plan,
  projectId,
  serverDone = [],
}: {
  plan: Plan;
  projectId?: string | null;
  /** saved project's done-steps — merged with device-local progress */
  serverDone?: number[];
}) {
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const steps = useMemo(() => [...plan.steps].sort((a, b) => a.n - b.n), [plan]);
  const key = useMemo(() => storageKey(projectId, plan), [projectId, plan]);

  function enter() {
    // restore saved progress — device-local ∪ server — resume at first open step
    const saved = [...new Set([...readDone(key), ...serverDone])].filter((n) =>
      steps.some((s) => s.n === n)
    );
    setDone(saved);
    const next = steps.findIndex((s) => !saved.includes(s.n));
    setIdx(next === -1 ? Math.max(0, steps.length - 1) : next);
    setActive(true);
  }

  // keep the screen awake while building
  useEffect(() => {
    if (!active) return;
    let lock: { release: () => Promise<void> } | null = null;
    const wl = (
      navigator as Navigator & {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      }
    ).wakeLock;
    void wl?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [active]);

  if (!steps.length) return null;
  const step = steps[idx];
  const isDone = done.includes(step.n);
  const doneCount = steps.filter((s) => done.includes(s.n)).length;

  function markDone() {
    const next = done.includes(step.n) ? done : [...done, step.n];
    setDone(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage full / private mode — progress just won't persist */
    }
    // saved project → sync for the dashboard's % done
    if (projectId)
      void fetch(`/api/projects/${projectId}/progress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps: next }),
      }).catch(() => {});
    if (idx < steps.length - 1) setIdx(idx + 1);
  }

  if (!active)
    return (
      <Button type="button" size="lg" onClick={enter}>
        <Play className="mr-2 h-4 w-4" /> Build mode
      </Button>
    );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-medium">
          {plan.title}
          <span className="ml-2 text-xs text-muted-foreground">
            {doneCount}/{steps.length} done
          </span>
        </p>
        <button
          type="button"
          aria-label="Exit build mode"
          onClick={() => setActive(false)}
          className="rounded-full p-1.5 hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-blueprint transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
        <p className="text-sm text-muted-foreground">
          Step {idx + 1} of {steps.length}
        </p>
        <h2 className="mt-1 text-2xl font-bold sm:text-3xl">
          <GlossedText text={step.title} />
        </h2>
        <p className="mt-4 text-lg leading-relaxed">
          <GlossedText text={step.text} />
        </p>

        {step.ppe && step.ppe.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {step.ppe.map((p) => {
              const { icon: Icon, label } = PPE_ICON[p];
              return (
                <span
                  key={p}
                  className="flex items-center gap-1.5 rounded-full border border-amber-500/50 px-3 py-1 text-xs"
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </span>
              );
            })}
          </div>
        )}

        {step.parts_used.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Parts: {step.parts_used.join(", ")}
          </p>
        )}
        {step.tools_used.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            Tools: {step.tools_used.join(", ")}
          </p>
        )}

        {step.safety && (
          <p className="mt-4 rounded-md border-l-4 border-amber-500 bg-amber-500/10 px-4 py-3 text-sm">
            <strong>Safety:</strong> {step.safety}
          </p>
        )}
        {step.tip && (
          <p className="mt-3 rounded-md border-l-4 border-blueprint/50 bg-blueprint/5 px-4 py-3 text-sm">
            <strong>Tip:</strong> {step.tip}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 border-t px-4 py-4">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={idx === 0}
          onClick={() => setIdx(idx - 1)}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          size="lg"
          className="flex-1"
          variant={isDone ? "secondary" : "default"}
          onClick={markDone}
        >
          <CheckCircle2 className="mr-2 h-5 w-5" />
          {isDone ? "Done — next" : "Mark done"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={idx === steps.length - 1}
          onClick={() => setIdx(idx + 1)}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* in-build "I'm stuck" — carries the current step as context */}
      <StuckChat plan={plan} step={step} projectId={projectId} />
    </div>
  );
}
