import type { Plan } from "@/lib/plan/schema";
import { solidsOf } from "@/lib/blueprint/solids";
import { projectPainter } from "@/lib/blueprint/explode";

const r1 = (x: number) => x.toFixed(1);

/** Small isometric thumbnail rendered from the plan's actual geometry. */
export function ProjectThumb({ plan }: { plan: Plan }) {
  const faces = projectPainter(solidsOf(plan));
  if (!faces.length) return <div className="h-16 w-24 rounded bg-muted" />;
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
  return (
    <svg
      viewBox={vb}
      className="h-16 w-24 shrink-0 rounded border bg-[#0b4f9c]"
      aria-hidden
    >
      {faces.map((f, i) => {
        const l = Math.round(255 - f.shade * 140);
        return (
          <polygon
            key={i}
            points={f.pts.map((q) => `${r1(q[0])},${r1(-q[1])}`).join(" ")}
            fill={`rgb(${Math.round(l * 0.55)},${Math.round(l * 0.75)},${l})`}
            stroke="#eaf3ff"
            strokeWidth={14}
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
