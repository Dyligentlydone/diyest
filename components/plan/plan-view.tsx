"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Biohazard,
  BookOpen,
  ChevronDown,
  Clock,
  Ear,
  Glasses,
  Hammer,
  Hand,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { BlueprintSheet } from "@/components/plan/blueprint-sheet";
import { BuildMode } from "@/components/plan/build-mode";
import { CutListView } from "@/components/plan/cutlist-view";
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
}) {
  const [units, setUnits] = useState<Units>(initialUnits);
  const [selId, setSelId] = useState<string | null>(null);
  const toggle = (id: string) => setSelId((s) => (s === id ? null : id));
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

  const requiredTools = shown.tools.filter((t) => t.required);
  const optionalTools = shown.tools.filter((t) => !t.required);
  const cutParts = shown.parts.filter((p) => p.source !== "buy");
  const buyParts = shown.parts.filter((p) => p.source === "buy");

  return (
    <div className="space-y-8">
      {/* overview */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">{shown.title}</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">{shown.summary}</p>
          </div>
          <button
            onClick={() => setUnits(units === "metric" ? "imperial" : "metric")}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Units: {units === "metric" ? "mm" : "in"} → switch to{" "}
            {units === "metric" ? "inches" : "mm"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="secondary" className="capitalize">
            {shown.difficulty}
          </Badge>
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" /> ~{shown.est_hours}h
          </Badge>
          <Badge variant="secondary">
            {money(shown.est_cost.low)}–{money(shown.est_cost.high)}
          </Badge>
          <Badge variant="secondary">
            {formatDimensions(shown.overall_dimensions_mm, units)}
          </Badge>
          {shown.load_bearing && (
            <Badge variant="destructive">
              <ShieldAlert className="mr-1 h-3 w-3" /> Load-bearing
            </Badge>
          )}
        </div>

        {shown.load_bearing && (
          <div className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
            <strong>Safety:</strong> this project carries weight or people. Verify all
            measurements, fasteners and anchoring before use, and consult a
            professional if you&apos;re unsure.
          </div>
        )}
      </section>

      {/* blueprint */}
      <section>
        <BlueprintSheet plan={shown} units={units} highlightPartId={selId} />
        <p className="mt-2 text-xs text-muted-foreground">
          Blueprint generated from plan geometry — measured views, not an
          illustration. Tap a part in any list to highlight it everywhere.
        </p>
      </section>

      <ModifyBar
        plan={shown}
        units={units}
        projectId={projectId}
        disabled={checking}
        onModified={setMod}
      />

      {shownPending && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <strong>Carpenter review pending.</strong> Our strongest checker
          didn&apos;t run on this plan — treat it as unchecked and verify
          joinery and fasteners before building.
        </div>
      )}

      {shownBlockers.length > 0 ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> This one&apos;s tricky.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s our best plan — but the carpenter review flagged{" "}
            {shownBlockers.length} item{shownBlockers.length > 1 ? "s" : ""} we
            couldn&apos;t fully resolve. Check the flagged items carefully
            before cutting.
          </p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Show {shownUnverified.length} flagged item{shownUnverified.length > 1 ? "s" : ""}
            </summary>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              {shownUnverified.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        shownUnverified.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> Unverified plan
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Automatic checks found issues the AI couldn&apos;t fix. Verify
              these by hand:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {shownUnverified.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )
      )}
      {shownWarnings.length > 0 && (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">Heads up</p>
          <ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground">
            {shownWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {shown.assumptions.length > 0 && (
        <details className="group rounded-md border p-4">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-medium">
            Assumptions diyest made ({shown.assumptions.length})
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {shown.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      {/* materials */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Hammer className="h-5 w-5" /> Parts
        </h2>
        <Card>
          <CardContent className="pt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-1 pr-2">ID</th>
                  <th className="py-1 pr-2">Part</th>
                  <th className="py-1 pr-2">Material</th>
                  <th className="py-1 pr-2">Size</th>
                  <th className="py-1 pr-2">Source</th>
                  <th className="py-1 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {[...cutParts, ...buyParts].map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={`cursor-pointer border-t transition-colors hover:bg-primary/5 ${
                      selId === p.id ? "bg-primary/10" : ""
                    }`}
                  >
                    <td className="py-1.5 pr-2 font-mono text-xs">{p.id}</td>
                    <td className="py-1.5 pr-2">
                      <GlossedText text={p.name} />
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{p.material}</td>
                    <td className="py-1.5 pr-2 font-mono text-xs">
                      {p.source === "buy" ? (
                        <span className="text-muted-foreground">{p.buy_spec ?? "—"}</span>
                      ) : (
                        <PartSize part={p} units={units} />
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-xs text-muted-foreground">
                      {p.source === "buy" ? "BUY" : "cut"}
                    </td>
                    <td className="py-1.5 text-right">{p.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* cut list */}
      {cutParts.length > 0 && (
        <CutListView
          plan={shown}
          units={units}
          kerfMm={kerfMm}
          selectedPart={selId}
          onPartSelect={setSelId}
        />
      )}

      {/* shopping list */}
      <ShoppingList
        plan={shown}
        units={units}
        kerfMm={kerfMm}
        projectId={projectId}
        serverHave={serverHave}
        excludeMaterials={excludeMaterials}
      />

      {/* tools */}
      {shown.tools.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Wrench className="h-5 w-5" /> Tools
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Required</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {requiredTools.map((t, i) => (
                    <li key={i}>
                      {t.name}
                      {t.alternative && (
                        <span className="block text-xs text-muted-foreground">
                          Alternative: {t.alternative}
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
                  <CardTitle className="text-sm">Nice to have</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm">
                    {optionalTools.map((t, i) => (
                      <li key={i}>{t.name}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      {/* safety */}
      {shown.safety_overview.length > 0 && (
        <section className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-5 w-5" /> Safety first
          </h2>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {shown.safety_overview.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {/* steps */}
      {shown.steps.length > 0 && (
        <section>
          <h2 className="mb-3 flex flex-wrap items-center gap-3 text-lg font-semibold">
            Build steps
            {checking && (
              <Badge variant="outline" className="border-primary/50 text-xs font-normal">
                Draft — carpenter check in progress
              </Badge>
            )}
            <span className="ml-auto">
              <BuildMode plan={shown} projectId={projectId} />
            </span>
          </h2>
          <div className="space-y-3">
            {[...shown.steps]
              .sort((a, b) => a.n - b.n)
              .map((s) => {
                const usesSel = selId != null && s.parts_used.includes(selId);
                return (
                  <Card
                    key={s.n}
                    className={
                      shownChanged.includes(s.n)
                        ? "border-amber-500/60 bg-amber-500/5"
                        : usesSel
                          ? "border-primary/60 bg-primary/5"
                          : undefined
                    }
                  >
                    <CardContent className="pt-5">
                      <div className="flex gap-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-primary-foreground">
                          {s.n}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium">
                            <GlossedText text={s.title} />
                            {shownChanged.includes(s.n) && (
                              <Badge variant="secondary" className="ml-2 text-[10px]">
                                updated by review
                              </Badge>
                            )}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            <GlossedText text={s.text} />
                          </p>
                          {s.ppe && s.ppe.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {s.ppe.map((p) => {
                                const { icon: Icon, label } = PPE_ICON[p];
                                return (
                                  <Badge
                                    key={p}
                                    variant="outline"
                                    className="gap-1 border-amber-500/50 text-[10px] font-normal"
                                    title={label}
                                  >
                                    <Icon className="h-3 w-3" aria-label={label} />
                                    {label}
                                  </Badge>
                                );
                              })}
                            </div>
                          )}
                          {s.parts_used.length > 0 && (
                            <p className="mt-2 flex flex-wrap gap-1 text-xs">
                              {s.parts_used.map((id) => (
                                <button
                                  key={id}
                                  onClick={() => toggle(id)}
                                  className={`rounded border px-1.5 py-0.5 font-mono transition-colors hover:bg-primary/10 ${
                                    selId === id
                                      ? "border-primary bg-primary/10"
                                      : "border-muted-foreground/30 text-muted-foreground"
                                  }`}
                                >
                                  {id}
                                </button>
                              ))}
                            </p>
                          )}
                          {s.tools_used.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Tools: {s.tools_used.join(", ")}
                            </p>
                          )}
                          {s.safety && (
                            <p className="mt-2 rounded border-l-2 border-amber-500 bg-amber-500/10 px-3 py-1.5 text-xs">
                              <strong>Safety:</strong> {s.safety}
                            </p>
                          )}
                          {s.tip && (
                            <p className="mt-2 rounded border-l-2 border-primary/50 bg-primary/5 px-3 py-1.5 text-xs">
                              <strong>Tip:</strong> {s.tip}
                            </p>
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

      {/* glossary */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5" /> Glossary
        </h2>
        <Card>
          <CardContent className="grid gap-x-6 gap-y-1 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            {GLOSSARY_TERMS.map((term) => (
              <details key={term} className="text-sm">
                <summary className="cursor-pointer py-1 font-medium capitalize">
                  {term}
                </summary>
                <p className="pb-2 pl-1 text-xs text-muted-foreground">
                  {GLOSSARY[term]}
                </p>
              </details>
            ))}
          </CardContent>
        </Card>
      </section>

      <Separator />
      <p className="text-xs text-muted-foreground">
        This plan was generated by AI. Verify every measurement against your actual
        materials before cutting.
      </p>

      <StuckChat plan={shown} projectId={projectId} />
    </div>
  );
}
