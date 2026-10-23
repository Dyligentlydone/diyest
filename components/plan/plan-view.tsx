"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Hammer,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { BlueprintSheet } from "@/components/plan/blueprint-sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { consumablesOf } from "@/lib/plan/derive";
import type { Plan } from "@/lib/plan/schema";
import { formatDimension, formatDimensions } from "@/lib/units";
import type { Units } from "@/lib/types";

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
}) {
  const [units, setUnits] = useState<Units>(initialUnits);
  const currency = plan.est_cost.currency;
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  const requiredTools = plan.tools.filter((t) => t.required);
  const optionalTools = plan.tools.filter((t) => !t.required);
  const cutParts = plan.parts.filter((p) => p.source !== "buy");
  const buyParts = plan.parts.filter((p) => p.source === "buy");

  return (
    <div className="space-y-8">
      {/* overview */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">{plan.title}</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">{plan.summary}</p>
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
            {plan.difficulty}
          </Badge>
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" /> ~{plan.est_hours}h
          </Badge>
          <Badge variant="secondary">
            {money(plan.est_cost.low)}–{money(plan.est_cost.high)}
          </Badge>
          <Badge variant="secondary">
            {formatDimensions(plan.overall_dimensions_mm, units)}
          </Badge>
          {plan.load_bearing && (
            <Badge variant="destructive">
              <ShieldAlert className="mr-1 h-3 w-3" /> Load-bearing
            </Badge>
          )}
        </div>

        {plan.load_bearing && (
          <div className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
            <strong>Safety:</strong> this project carries weight or people. Verify all
            measurements, fasteners and anchoring before use, and consult a
            professional if you&apos;re unsure.
          </div>
        )}
      </section>

      {/* blueprint */}
      <section>
        <BlueprintSheet plan={plan} units={units} />
        <p className="mt-2 text-xs text-muted-foreground">
          Blueprint generated from plan geometry — measured views, not an
          illustration.
        </p>
      </section>

      {reviewPending && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <strong>Carpenter review pending.</strong> Our strongest checker
          didn&apos;t run on this plan — treat it as unchecked and verify
          joinery and fasteners before building.
        </div>
      )}

      {blockers.length > 0 ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> This one&apos;s tricky.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s our best plan — but the carpenter review flagged{" "}
            {blockers.length} item{blockers.length > 1 ? "s" : ""} we
            couldn&apos;t fully resolve. Check the flagged items carefully
            before cutting.
          </p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Show {unverified.length} flagged item{unverified.length > 1 ? "s" : ""}
            </summary>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              {unverified.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        unverified.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> Unverified plan
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Automatic checks found issues the AI couldn&apos;t fix. Verify
              these by hand:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {unverified.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )
      )}
      {warnings.length > 0 && (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">Heads up</p>
          <ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.assumptions.length > 0 && (
        <details className="group rounded-md border p-4">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-medium">
            Assumptions diyest made ({plan.assumptions.length})
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {plan.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      {/* materials */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Hammer className="h-5 w-5" /> Materials &amp; hardware
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Parts to cut</CardTitle>
            </CardHeader>
            <CardContent>
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
                  {cutParts.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-1.5 pr-2 font-mono text-xs">{p.id}</td>
                      <td className="py-1.5 pr-2">{p.name}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{p.material}</td>
                      <td className="py-1.5 pr-2 font-mono text-xs">
                        <PartSize part={p} units={units} />
                      </td>
                      <td className="py-1.5 text-right">{p.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {buyParts.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Buy these parts</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm">
                    {buyParts.map((p) => (
                      <li key={p.id} className="flex justify-between gap-3">
                        <span>
                          {p.name}
                          <span className="block text-xs text-muted-foreground">
                            {p.buy_spec ?? "off-the-shelf"}
                          </span>
                        </span>
                        <span className="shrink-0 text-muted-foreground">×{p.qty}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            {plan.hardware.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Hardware</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {plan.hardware.map((h, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>
                        {h.name}
                        {h.size ? ` — ${h.size}` : ""}
                        {h.notes && (
                          <span className="block text-xs text-muted-foreground">
                            {h.notes}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-muted-foreground">×{h.qty}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            )}

            {consumablesOf(plan).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Consumables</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm">
                    {consumablesOf(plan).map((f, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>
                          {f.name}
                          {f.note && (
                            <span className="block text-xs text-muted-foreground">
                              {f.note}
                            </span>
                          )}
                        </span>
                        {f.qty && (
                          <span className="shrink-0 text-muted-foreground">{f.qty}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <div className="rounded-md border p-4 text-sm">
              <span className="text-muted-foreground">Estimated total: </span>
              <span className="font-medium">
                {money(plan.est_cost.low)}–{money(plan.est_cost.high)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* tools */}
      {plan.tools.length > 0 && (
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
      {plan.safety_overview.length > 0 && (
        <section className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-5 w-5" /> Safety first
          </h2>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {plan.safety_overview.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {/* steps */}
      {plan.steps.length > 0 && (
      <section>
        <h2 className="mb-3 flex flex-wrap items-center gap-3 text-lg font-semibold">
          Build steps
          {checking && (
            <Badge variant="outline" className="border-primary/50 text-xs font-normal">
              Draft — carpenter check in progress
            </Badge>
          )}
        </h2>
        <div className="space-y-3">
          {[...plan.steps]
            .sort((a, b) => a.n - b.n)
            .map((s) => (
              <Card
                key={s.n}
                className={
                  changedSteps.includes(s.n)
                    ? "border-amber-500/60 bg-amber-500/5"
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
                        {s.title}
                        {changedSteps.includes(s.n) && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            updated by review
                          </Badge>
                        )}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
                      {s.parts_used.length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Parts:{" "}
                          {s.parts_used
                            .map(
                              (id) =>
                                `${id} (${plan.parts.find((p) => p.id === id)?.name ?? "?"})`
                            )
                            .join(", ")}
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
            ))}
        </div>
      </section>
      )}

      <Separator />
      <p className="text-xs text-muted-foreground">
        This plan was generated by AI. Verify every measurement against your actual
        materials before cutting.
      </p>
    </div>
  );
}
