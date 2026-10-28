"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Biohazard,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Ear,
  Glasses,
  Hammer,
  Hand,
  Layers,
  ListChecks,
  ShieldAlert,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import { BlueprintSheet } from "@/components/plan/blueprint-sheet";
import { BuildMode } from "@/components/plan/build-mode";
import { Preview3D } from "@/components/plan/preview-3d";
import { CutListView } from "@/components/plan/cutlist-view";
import { PlanFeedback, StepFeedback } from "@/components/plan/feedback";
import { GlossedText } from "@/components/plan/glossed-text";
import { ModifyBar, type ModifyResult } from "@/components/plan/modify-bar";
import { ShoppingList } from "@/components/plan/shopping-list";
import { StuckChat } from "@/components/plan/stuck-chat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GLOSSARY, GLOSSARY_TERMS } from "@/lib/glossary";
import type { Plan, Ppe } from "@/lib/plan/schema";
import { formatDimension, formatDimensions } from "@/lib/units";
import type { Units } from "@/lib/types";

const PPE_ICON: Record<Ppe, { icon: typeof Glasses; label: string }> = {
  glasses: { icon: Glasses, label: "safety glasses" },
  hearing: { icon: Ear, label: "hearing protection" },
  mask: { icon: Biohazard, label: "dust mask / respirator" },
  gloves: { icon: Hand, label: "gloves" },
};

type VisualMode = "blueprint" | "3d" | "both";
type SectionTab = "steps" | "shopping" | "parts" | "all";

function PartSize({ part, units }: { part: Plan["parts"][number]; units: Units }) {
  const pl = part.placements[0];
  if (pl && "from" in pl && part.cross_section) {
    const cs = part.cross_section;
    const sec =
      cs.shape === "round"
        ? `⌀${formatDimension(cs.d, units)}${cs.end_d ? `→${formatDimension(cs.end_d, units)}` : ""}`
        : `${formatDimension(cs.w, units)} × ${formatDimension(cs.t, units)}${
            cs.end_w ? ` → ${formatDimension(cs.end_w, units)} × ${formatDimension(cs.end_t ?? cs.t, units)}` : ""
          }`;
    return (
      <>
        {formatDimension(part.length_mm, units)} × {sec}
      </>
    );
  }
  return (
    <>
      {formatDimension(part.length_mm, units)} × {formatDimension(part.width_mm, units)} ×{" "}
      {formatDimension(part.thickness_mm, units)}
      {units === "metric" ? " mm" : ""}
    </>
  );
}

/** Deduplicate tools by lowercase name, merging any distinct alternatives. */
function dedupeTools(tools: Plan["tools"]): Plan["tools"] {
  const map = new Map<string, Plan["tools"][number]>();
  for (const t of tools) {
    const key = t.name.trim().toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...t, name: t.name.trim() });
    } else {
      prev.required = prev.required || t.required;
      if (t.alternative && !prev.alternative?.includes(t.alternative)) {
        prev.alternative = prev.alternative
          ? `${prev.alternative}; or ${t.alternative}`
          : t.alternative;
      }
    }
  }
  return [...map.values()];
}

export function PlanView({
  plan,
  units: initialUnits,
  unverified = [],
  blockers = [],
  warnings = [],
  reviewPending = false,
  checking = false,
  changedSteps = [],
  kerfMm = 3,
  projectId,
  serverHave = [],
  excludeMaterials = [],
  serverDone = [],
}: {
  plan: Plan;
  units: Units;
  unverified?: string[];
  /** blocker-level residuals → friendly "tricky" banner, details collapsed */
  blockers?: string[];
  warnings?: string[];
  /** configured review model failed — plan is not fully checked */
  reviewPending?: boolean;
  /** review still running — steps are drafts until it lands */
  checking?: boolean;
  /** step numbers the carpenter-review repair changed */
  changedSteps?: number[];
  /** saw kerf from user profile — used by the cut-list optimizer */
  kerfMm?: number;
  /** saved project → shopping "already have" marks persist server-side */
  projectId?: string | null;
  serverHave?: string[];
  /** leftovers mode — materials the user owns are dropped from the list */
  excludeMaterials?: string[];
  /** saved project's done-steps — seeds build mode on other devices */
  serverDone?: number[];
}) {
  const [units, setUnits] = useState<Units>(initialUnits);
  const [selId, setSelId] = useState<string | null>(plan.parts[0]?.id ?? null);
  const [visualMode, setVisualMode] = useState<VisualMode>("blueprint");
  const [tab, setTab] = useState<SectionTab>("steps");
  const [doneSteps, setDoneSteps] = useState<Set<number>>(() => new Set(serverDone));

  const toggle = (id: string) => setSelId((s) => (s === id ? null : id));
  const toggleStepDone = (n: number) => {
    setDoneSteps((prev) => {
      const next = new Set(prev);
      const done = !next.has(n);
      if (done) next.add(n);
      else next.delete(n);
      if (projectId) {
        void fetch(`/api/projects/${projectId}/steps`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stepN: n, done }),
        }).catch(() => {});
      }
      return next;
    });
  };

  // a successful modify swaps in the re-checked plan + its review state
  const [mod, setMod] = useState<ModifyResult | null>(null);
  const shown = mod?.plan ?? plan;
  const shownUnverified = mod ? mod.unverified : unverified;
  const shownBlockers = mod ? mod.blockers : blockers;
  const shownWarnings = mod ? mod.warnings : warnings;
  const shownPending = mod ? mod.reviewPending : reviewPending;
  const shownChanged = mod ? mod.changedSteps : changedSteps;

  const currency = shown.est_cost.currency;
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  const uniqueTools = useMemo(() => dedupeTools(shown.tools), [shown.tools]);
  const requiredTools = uniqueTools.filter((t) => t.required);
  const optionalTools = uniqueTools.filter((t) => !t.required);
  const cutParts = shown.parts.filter((p) => p.source !== "buy");
  const buyParts = shown.parts.filter((p) => p.source === "buy");
  const partById = useMemo(
    () => new Map(shown.parts.map((p) => [p.id, p])),
    [shown.parts]
  );

  // Only show glossary terms that actually appear in this plan's text
  const relevantGlossary = useMemo(() => {
    const haystack = [
      shown.summary,
      ...shown.parts.map((p) => `${p.name} ${p.material} ${p.notes ?? ""}`),
      ...shown.steps.map((s) => `${s.title} ${s.text} ${s.tip ?? ""}`),
    ]
      .join(" ")
      .toLowerCase();
    const matched = GLOSSARY_TERMS.filter((term) => haystack.includes(term.toLowerCase()));
    return matched.length ? matched : GLOSSARY_TERMS.slice(0, 12);
  }, [shown]);

  return (
    <div className="space-y-6">
      {/* overview header */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">{shown.title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {shown.summary}
            </p>
          </div>
          <button
            onClick={() => setUnits(units === "metric" ? "imperial" : "metric")}
            className="rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            {units === "metric" ? "mm → inches" : "inches → mm"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary" className="capitalize">
            {shown.difficulty}
          </Badge>
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" /> ~{shown.est_hours}h
          </Badge>
          <Badge variant="secondary">
            {money(shown.est_cost.low)}–{money(shown.est_cost.high)} est.
          </Badge>
          <Badge variant="secondary">
            {formatDimensions(shown.overall_dimensions_mm, units)}
          </Badge>
          <Badge variant="outline">{shown.parts.length} parts</Badge>
          <Badge variant="outline">{shown.steps.length} steps</Badge>
          {shown.load_bearing && (
            <Badge variant="destructive">
              <ShieldAlert className="mr-1 h-3 w-3" /> Load-bearing
            </Badge>
          )}
        </div>
      </section>

      {/* blueprint / 3D switcher — keeps the visual area compact on one screen */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
            {(
              [
                ["blueprint", "Blueprint"],
                ["3d", "3D preview"],
                ["both", "Split view"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setVisualMode(k)}
                className={`rounded-md px-3 py-1 font-medium transition-colors ${
                  visualMode === k
                    ? "bg-blueprint text-blueprint-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {selId ? (
            <button
              type="button"
              onClick={() => setSelId(null)}
              className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium"
            >
              Highlighting {selId} ({partById.get(selId)?.name}) · Clear ×
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Click any part ID below to highlight it on the blueprint
            </span>
          )}
        </div>

        {(visualMode === "blueprint" || visualMode === "both") && (
          <BlueprintSheet plan={shown} units={units} highlightPartId={selId} />
        )}
        {(visualMode === "3d" || visualMode === "both") && (
          <div className={visualMode === "both" ? "pt-2" : undefined}>
            <Preview3D plan={shown} />
          </div>
        )}
      </section>

      {/* status banners + quick modify */}
      <div className="space-y-2">
        <ModifyBar
          plan={shown}
          units={units}
          projectId={projectId}
          disabled={checking}
          onModified={setMod}
        />

        {shownPending && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
            <strong>Carpenter review pending.</strong> Verify joinery and
            fasteners before building.
          </div>
        )}

        {shownBlockers.length > 0 ? (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
            <p className="flex items-center gap-2 font-medium text-sm">
              <AlertTriangle className="h-4 w-4" /> This one&apos;s tricky ({shownBlockers.length} item
              {shownBlockers.length > 1 ? "s" : ""} to double-check)
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground">
                Show details
              </summary>
              <ul className="mt-1.5 list-inside list-disc space-y-1 text-muted-foreground">
                {shownUnverified.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : (
          shownUnverified.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs">
              <p className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> Unverified items
              </p>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {shownUnverified.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )
        )}

        {shownWarnings.length > 0 && (
          <details className="group rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <summary className="flex cursor-pointer items-center justify-between font-medium">
              <span>Heads up ({shownWarnings.length})</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              {shownWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}

        {shown.assumptions.length > 0 && (
          <details className="group rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <summary className="flex cursor-pointer items-center justify-between font-medium">
              <span>Assumptions diyest made ({shown.assumptions.length})</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              {shown.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* sticky section tab bar — breaks the long scroll into 3 focused views */}
      <div className="sticky top-14 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/95 p-1.5 backdrop-blur">
        <div className="flex flex-wrap gap-1">
          {(
            [
              {
                id: "steps",
                label: `Build steps (${shown.steps.length})`,
                icon: ListChecks,
              },
              {
                id: "shopping",
                label: `Shopping & tools (${uniqueTools.length})`,
                icon: ShoppingCart,
              },
              {
                id: "parts",
                label: `Parts & cut list (${shown.parts.length})`,
                icon: Hammer,
              },
              {
                id: "all",
                label: "Show all",
                icon: Layers,
              },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === id
                  ? "bg-blueprint text-blueprint-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        {shown.steps.length > 0 && (
          <div className="flex items-center gap-2 pr-1">
            {doneSteps.size > 0 && (
              <span className="text-xs text-muted-foreground">
                {doneSteps.size}/{shown.steps.length} done
              </span>
            )}
            <BuildMode plan={shown} projectId={projectId} serverDone={serverDone} />
          </div>
        )}
      </div>

      {/* ===================== TAB 1: BUILD STEPS ===================== */}
      {(tab === "steps" || tab === "all") && shown.steps.length > 0 && (
        <section className="space-y-3">
          {/* compact collapsible safety banner right above the steps */}
          {(shown.safety_overview.length > 0 || shown.load_bearing) && (
            <details
              open={shown.load_bearing}
              className="group rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs"
            >
              <summary className="flex cursor-pointer items-center justify-between font-semibold text-sm">
                <span className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  Safety checklist ({shown.safety_overview.length})
                  {shown.load_bearing && (
                    <Badge variant="destructive" className="text-[10px]">
                      Load-bearing
                    </Badge>
                  )}
                </span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
                {shown.load_bearing && (
                  <li className="font-medium text-foreground">
                    This project carries weight — verify all measurements,
                    fasteners, and anchoring before use.
                  </li>
                )}
                {shown.safety_overview.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}

          {checking && (
            <Badge variant="outline" className="border-blueprint/50 text-xs font-normal">
              Draft — carpenter check in progress
            </Badge>
          )}

          <div className="space-y-2.5">
            {[...shown.steps]
              .sort((a, b) => a.n - b.n)
              .map((s) => {
                const usesSel = selId != null && s.parts_used.includes(selId);
                const isDone = doneSteps.has(s.n);
                return (
                  <Card
                    key={s.n}
                    className={
                      shownChanged.includes(s.n)
                        ? "border-amber-500/60 bg-amber-500/5"
                        : usesSel
                          ? "border-blueprint/60 bg-blueprint/5"
                          : isDone
                            ? "opacity-65"
                            : undefined
                    }
                  >
                    <CardContent className="py-4">
                      <div className="flex gap-3.5">
                        <button
                          type="button"
                          onClick={() => toggleStepDone(s.n)}
                          title={isDone ? "Mark step incomplete" : "Mark step done"}
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold transition-colors ${
                            isDone
                              ? "border-blueprint bg-blueprint text-blueprint-foreground"
                              : "border-blueprint/40 bg-blueprint/10 text-foreground hover:bg-blueprint hover:text-blueprint-foreground"
                          }`}
                        >
                          {isDone ? <Check className="h-3.5 w-3.5" /> : s.n}
                        </button>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className={`font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
                              <GlossedText text={s.title} />
                              {shownChanged.includes(s.n) && (
                                <Badge variant="secondary" className="ml-2 text-[10px]">
                                  updated by review
                                </Badge>
                              )}
                            </h3>
                            <StepFeedback projectId={projectId} stepN={s.n} />
                          </div>

                          <p className="text-sm leading-relaxed text-muted-foreground">
                            <GlossedText text={s.text} />
                          </p>

                          {/* compact inline row: clickable part chips + tools + PPE icons */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                            {s.parts_used.map((id) => {
                              const pName = partById.get(id)?.name;
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => toggle(id)}
                                  title={pName ? `${id}: ${pName}` : id}
                                  className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-blueprint/10 ${
                                    selId === id
                                      ? "border-blueprint bg-blueprint/15 font-semibold"
                                      : "border-muted-foreground/30 text-muted-foreground"
                                  }`}
                                >
                                  {id}
                                  {s.parts_used.length <= 4 && pName ? (
                                    <span className="ml-1 font-sans font-normal opacity-80">
                                      · {pName}
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                            {s.tools_used.length > 0 && (
                              <span className="ml-1 text-[11px] text-muted-foreground">
                                · Tools: {s.tools_used.join(", ")}
                              </span>
                            )}
                            {s.ppe && s.ppe.length > 0 && (
                              <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
                                {s.ppe.map((p) => {
                                  const { icon: Icon, label } = PPE_ICON[p];
                                  return (
                                    <span
                                      key={p}
                                      title={`Wear ${label}`}
                                      className="inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/5 px-1.5 py-0.5 text-[10px]"
                                    >
                                      <Icon className="h-3 w-3" aria-label={label} />
                                      <span className="hidden sm:inline">{label}</span>
                                    </span>
                                  );
                                })}
                              </span>
                            )}
                          </div>

                          {(s.tip || s.safety) && (
                            <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
                              {s.tip && (
                                <p className="rounded border-l-2 border-blueprint/50 bg-blueprint/5 px-2.5 py-1.5 text-xs text-muted-foreground">
                                  <strong className="text-foreground">Tip:</strong> {s.tip}
                                </p>
                              )}
                              {s.safety && (
                                <p className="rounded border-l-2 border-amber-500 bg-amber-500/10 px-2.5 py-1.5 text-xs text-muted-foreground">
                                  <strong className="text-foreground">Safety:</strong> {s.safety}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </section>
      )}

      {/* ===================== TAB 2: SHOPPING & TOOLS ===================== */}
      {(tab === "shopping" || tab === "all") && (
        <div className="space-y-6">
          <ShoppingList
            plan={shown}
            units={units}
            kerfMm={kerfMm}
            projectId={projectId}
            serverHave={serverHave}
            excludeMaterials={excludeMaterials}
          />

          {uniqueTools.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Wrench className="h-5 w-5" /> Tools ({uniqueTools.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      Required ({requiredTools.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="divide-y text-sm">
                      {requiredTools.map((t, i) => (
                        <li key={i} className="py-1.5 first:pt-0 last:pb-0">
                          <span className="font-medium capitalize">{t.name}</span>
                          {t.alternative && (
                            <span className="block text-xs text-muted-foreground">
                              No {t.name.toLowerCase()}? {t.alternative}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                {optionalTools.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">
                        Nice to have ({optionalTools.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="divide-y text-sm">
                        {optionalTools.map((t, i) => (
                          <li key={i} className="py-1.5 capitalize first:pt-0 last:pb-0">
                            {t.name}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ===================== TAB 3: PARTS & CUT LIST ===================== */}
      {(tab === "parts" || tab === "all") && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Hammer className="h-5 w-5" /> Parts ({shown.parts.length})
            </h2>
            <Card>
              <CardContent className="overflow-x-auto pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 pr-2">ID</th>
                      <th className="py-1 pr-2">Part</th>
                      <th className="py-1 pr-2">Material</th>
                      <th className="py-1 pr-2">Size</th>
                      <th className="py-1 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...cutParts, ...buyParts].map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => toggle(p.id)}
                        className={`cursor-pointer border-t transition-colors hover:bg-blueprint/5 ${
                          selId === p.id ? "bg-blueprint/10" : ""
                        }`}
                      >
                        <td className="py-1.5 pr-2 font-mono text-xs font-semibold">
                          {p.id}
                        </td>
                        <td className="py-1.5 pr-2 font-medium">
                          <GlossedText text={p.name} />
                          {p.source === "buy" && (
                            <Badge variant="outline" className="ml-1.5 text-[10px]">
                              buy
                            </Badge>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-muted-foreground">
                          {p.material}
                        </td>
                        <td className="py-1.5 pr-2 font-mono text-xs">
                          {p.source === "buy" ? (
                            <span className="text-muted-foreground">{p.buy_spec ?? "—"}</span>
                          ) : (
                            <PartSize part={p} units={units} />
                          )}
                        </td>
                        <td className="py-1.5 text-right font-mono text-xs">{p.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </section>

          {cutParts.length > 0 && (
            <CutListView
              plan={shown}
              units={units}
              kerfMm={kerfMm}
              selectedPart={selId}
              onPartSelect={setSelId}
            />
          )}
        </div>
      )}

      {/* collapsible glossary of only the terms used in this plan + feedback */}
      <div className="space-y-3 pt-2">
        {!checking && <PlanFeedback projectId={projectId} />}

        <details className="group rounded-md border bg-card px-4 py-3">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              Woodworking terms in this plan ({relevantGlossary.length})
            </span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 grid gap-x-6 gap-y-2 border-t pt-3 sm:grid-cols-2">
            {relevantGlossary.map((term) => (
              <div key={term} className="text-xs">
                <span className="font-semibold capitalize text-foreground">
                  {term}:
                </span>{" "}
                <span className="text-muted-foreground">{GLOSSARY[term]}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Verify every measurement against your actual materials before cutting.
      </p>

      <StuckChat plan={shown} projectId={projectId} />
    </div>
  );
}
