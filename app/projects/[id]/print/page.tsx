import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { denyPageIfNoInvite } from "@/lib/site-mode";
import { planSchema } from "@/lib/plan/schema";
import { createClient } from "@/lib/supabase/server";
import { renderBlueprint } from "@/lib/blueprint/render";
import { renderExplodedSvg } from "@/lib/blueprint/explode";
import { renderPartSheet, templatePages, templatedParts } from "@/lib/blueprint/sheets";
import { computeCutList, stockLabel } from "@/lib/plan/cutlist";
import { buildShoppingList } from "@/lib/plan/shopping";
import { formatDimension, formatDimensions } from "@/lib/units";
import type { Units } from "@/lib/types";
import { PrintButton } from "./print-button";

export const metadata = { title: "Printable plan — diyest" };

const P: React.CSSProperties = { breakInside: "avoid" };
const H2: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: "18px 0 8px",
  borderBottom: "2px solid #000",
  paddingBottom: 4,
};

async function PrintContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/projects/${id}/print`);
  await denyPageIfNoInvite(user.id);

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, plan, shopping_have")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  const { data: profile } = await supabase
    .from("profiles")
    .select("units, kerf_mm")
    .eq("id", user.id)
    .maybeSingle();
  const units: Units = profile?.units === "imperial" ? "imperial" : "metric";
  const kerfMm = typeof profile?.kerf_mm === "number" ? profile.kerf_mm : 3;

  const parsed = planSchema.safeParse(project.plan);
  if (!parsed.success) notFound();
  const plan = parsed.data;

  const fmt = (mm: number) => formatDimension(mm, units);
  const cut = computeCutList(plan, { kerfMm });
  const shopping = buildShoppingList(plan, cut, units);
  const have = new Set((project.shopping_have as string[] | null) ?? []);
  const blueprint = renderBlueprint(plan, units, undefined, "print");
  const exploded = renderExplodedSvg(plan, { variant: "print" });
  const shaped = templatedParts(plan);

  return (
    <main
      className="mx-auto max-w-[210mm] bg-white px-6 py-8 text-black print:px-0 print:py-0"
      style={{ fontFamily: "ui-monospace, monospace" }}
    >
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-neutral-500">
          Print at 100% scale — template pages are true size.
        </p>
        <PrintButton />
      </div>

      {/* cover / overview */}
      <header style={P}>
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          diyest build plan
        </p>
        <h1 className="mt-1 text-3xl font-bold">{plan.title}</h1>
        <p className="mt-2 text-sm text-neutral-700">{plan.summary}</p>
        <p className="mt-2 text-sm">
          <strong>{plan.difficulty}</strong> · ~{plan.est_hours}h ·{" "}
          {formatDimensions(plan.overall_dimensions_mm, units)}
          {plan.load_bearing ? " · LOAD-BEARING — verify all fasteners" : ""}
        </p>
      </header>

      {/* blueprint sheet */}
      <section style={{ breakBefore: "page" }}>
        <h2 style={H2}>Blueprint</h2>
        <div dangerouslySetInnerHTML={{ __html: blueprint }} />
      </section>

      {/* exploded view */}
      {exploded && (
        <section style={{ breakBefore: "page" }}>
          <h2 style={H2}>Exploded view</h2>
          <div dangerouslySetInnerHTML={{ __html: exploded }} />
        </section>
      )}

      {/* cut list */}
      {(cut.boards.length > 0 || cut.sheets.length > 0) && (
        <section style={{ ...P, breakBefore: "page" }}>
          <h2 style={H2}>Cut list &amp; board layout</h2>
          {[...cut.boards, ...cut.sheets].map((stock, i) => (
            <div key={i} className="mb-4" style={P}>
              <p className="text-sm font-semibold">
                {stockLabel(stock, units)} — {Math.round(stock.usedPct * 100)}% used
              </p>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {stock.cuts.map((pc, j) => (
                    <tr key={j} className="border-t border-neutral-200">
                      <td className="py-1 font-mono">{pc.partId}</td>
                      <td className="py-1">{pc.name}</td>
                      <td className="py-1 text-right">
                        {pc.width != null
                          ? `${fmt(pc.width)} × ${fmt(pc.length)}`
                          : fmt(pc.length)}
                        {pc.note ? ` — ${pc.note}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {cut.loose.length > 0 && (
            <p className="text-xs text-neutral-600">
              Not cut from stock: {cut.loose.map((l) => l.name).join(", ")}
            </p>
          )}
        </section>
      )}

      {/* shopping list */}
      <section style={{ breakBefore: "page" }}>
        <h2 style={H2}>Shopping list</h2>
        {shopping.sections.map((s) => (
          <div key={s.name} style={P} className="mb-3">
            <p className="text-sm font-semibold uppercase tracking-wide">
              {s.name}
            </p>
            <ul className="mt-1 text-xs">
              {s.items.map((i) => (
                <li key={i.key} className="border-b border-neutral-100 py-1">
                  <span className="mr-2 inline-block h-3 w-3 border border-black align-middle" />
                  {i.name}
                  {i.spec ? ` — ${i.spec}` : ""}
                  {i.estUsd != null && (
                    <span className="float-right">est. ${i.estUsd}</span>
                  )}
                  {have.has(i.key) && (
                    <span className="ml-2 text-neutral-500">(have)</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs text-neutral-600">
          Estimated total: ~${shopping.estTotalUsd} (estimates only)
        </p>
      </section>

      {/* tools + safety */}
      <section style={P}>
        <h2 style={H2}>Tools &amp; safety</h2>
        <p className="text-xs">
          <strong>Required:</strong>{" "}
          {plan.tools.filter((t) => t.required).map((t) => t.name).join(", ")}
        </p>
        <ul className="mt-2 list-inside list-disc text-xs">
          {plan.safety_overview.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </section>

      {/* steps */}
      <section style={{ breakBefore: "page" }}>
        <h2 style={H2}>Build steps</h2>
        {[...plan.steps]
          .sort((a, b) => a.n - b.n)
          .map((s) => (
            <div key={s.n} className="mb-4" style={P}>
              <p className="text-sm font-bold">
                {s.n}. {s.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed">{s.text}</p>
              <p className="mt-1 text-[10px] text-neutral-600">
                {s.parts_used.length > 0 && `Parts: ${s.parts_used.join(", ")} · `}
                {s.tools_used.length > 0 && `Tools: ${s.tools_used.join(", ")}`}
              </p>
              {s.safety && (
                <p className="mt-1 border-l-2 border-black pl-2 text-xs">
                  <strong>Safety:</strong> {s.safety}
                </p>
              )}
              {s.tip && (
                <p className="mt-1 text-xs italic text-neutral-600">
                  Tip: {s.tip}
                </p>
              )}
            </div>
          ))}
      </section>

      {/* part sheets */}
      <section style={{ breakBefore: "page" }}>
        <h2 style={H2}>Part drawings</h2>
        <div className="grid grid-cols-2 gap-4">
          {plan.parts.map((p) => (
            <div
              key={p.id}
              style={P}
              dangerouslySetInnerHTML={{
                __html: renderPartSheet(p, p.qty, units),
              }}
            />
          ))}
        </div>
      </section>

      {/* full-size templates */}
      {shaped.map((p) =>
        templatePages(p).map((pg) => (
          <section key={`${p.id}-${pg.label}`} style={{ breakBefore: "page" }}>
            <h2 style={H2}>
              Template — {p.name} ({pg.label})
            </h2>
            <p className="mb-2 text-xs text-neutral-600">
              Print at 100% scale. Align the crosshairs between tiles, tape,
              then trace onto the board.
            </p>
            <div dangerouslySetInnerHTML={{ __html: pg.svg }} />
          </section>
        ))
      )}

      <footer className="mt-8 border-t pt-3 text-[10px] text-neutral-500" style={P}>
        Generated by diyest — AI plan. Verify every measurement against your
        actual materials before cutting. {plan.title}
      </footer>
    </main>
  );
}

export default function PrintPage(props: PageProps<"/projects/[id]">) {
  if (!isSupabaseConfigured()) notFound();
  return (
    <Suspense fallback={null}>
      <PrintContent params={props.params} />
    </Suspense>
  );
}
