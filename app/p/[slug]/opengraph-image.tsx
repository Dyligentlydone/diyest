import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { planSchema } from "@/lib/plan/schema";
import { createClient } from "@/lib/supabase/server";
import { solidsOf } from "@/lib/blueprint/solids";
import { projectPainter } from "@/lib/blueprint/explode";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const r1 = (x: number) => x.toFixed(1);

/** OG card: blueprint-blue isometric render of the plan + title. */
export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!isSupabaseConfigured()) notFound();
  const { slug } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("title, plan")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();
  const parsed = project ? planSchema.safeParse(project.plan) : null;
  if (!parsed?.success) notFound();
  const plan = parsed.data;

  const faces = projectPainter(solidsOf(plan));
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (const f of faces)
    for (const [u, v] of f.pts) {
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
  const pad = (u1 - u0) * 0.08 + 1;
  const vb = `${r1(u0 - pad)} ${r1(-v1 - pad)} ${r1(u1 - u0 + pad * 2)} ${r1(
    v1 - v0 + pad * 2
  )}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0b4f9c",
          color: "#eaf3ff",
          fontFamily: "monospace",
        }}
      >
        <div
          style={{
            flex: 1.2,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: 64,
          }}
        >
          <div style={{ fontSize: 22, letterSpacing: 4, opacity: 0.7 }}>
            DIYEST BUILD PLAN
          </div>
          <div
            style={{
              fontSize: 52,
              fontWeight: 700,
              marginTop: 16,
              lineHeight: 1.15,
              display: "-webkit-box",
              overflow: "hidden",
            }}
          >
            {plan.title}
          </div>
          <div style={{ fontSize: 24, marginTop: 20, opacity: 0.85 }}>
            {plan.difficulty} · ~{plan.est_hours}h · blueprint + cut list + steps
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg viewBox={vb} width={520} height={520}>
            {faces.map((f, i) => {
              const l = Math.round(255 - f.shade * 140);
              return (
                <polygon
                  key={i}
                  points={f.pts
                    .map((q) => `${r1(q[0])},${r1(-q[1])}`)
                    .join(" ")}
                  fill={`rgb(${Math.round(l * 0.55)},${Math.round(l * 0.75)},${l})`}
                  stroke="#eaf3ff"
                  strokeWidth={8}
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>
        </div>
      </div>
    ),
    { ...size }
  );
}
