"use client";

import { useMemo, useRef, useState } from "react";
import { Box } from "lucide-react";
import type { Plan } from "@/lib/plan/schema";
import { solidsOf } from "@/lib/blueprint/solids";
import { explodeSolids, projectPainter } from "@/lib/blueprint/explode";

const r1 = (x: number) => x.toFixed(1);

/**
 * Interactive 3D preview built from the plan's actual geometry — no WebGL:
 * rotate by dragging, pull apart with the explode slider. Faces are
 * painter-sorted so occlusion is correct without a depth buffer.
 */
export function Preview3D({ plan }: { plan: Plan }) {
  const solids = useMemo(() => solidsOf(plan), [plan]);
  const [yaw, setYaw] = useState(35);
  const [pitch, setPitch] = useState(-28);
  const [explode, setExplode] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const faces = useMemo(
    () =>
      projectPainter(
        explode > 0 ? explodeSolids(solids, explode * 0.3) : solids,
        yaw,
        pitch
      ),
    [solids, yaw, pitch, explode]
  );

  const view = useMemo(() => {
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
    const pad = Math.max(u1 - u0, v1 - v0) * 0.08 + 1;
    return `${r1(u0 - pad)} ${r1(-v1 - pad)} ${r1(u1 - u0 + pad * 2)} ${r1(
      v1 - v0 + pad * 2
    )}`;
  }, [faces]);

  if (!solids.length) return null;

  return (
    <div className="space-y-2">
      <div
        className="touch-none select-none overflow-hidden rounded-md border bg-[#0b4f9c]"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setYaw((y) => y + (e.clientX - drag.current!.x) * 0.5);
          setPitch((p) =>
            Math.max(-89, Math.min(89, p - (e.clientY - drag.current!.y) * 0.5))
          );
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label={`3D preview of ${plan.title} — drag to rotate`}
      >
        <svg viewBox={view} className="h-64 w-full sm:h-80">
          {faces.map((f, i) => {
            const l = Math.round(255 - f.shade * 140);
            return (
              <polygon
                key={i}
                points={f.pts.map((q) => `${r1(q[0])},${r1(-q[1])}`).join(" ")}
                fill={`rgb(${Math.round(l * 0.55)},${Math.round(l * 0.75)},${l})`}
                stroke="#eaf3ff"
                strokeWidth={Math.max(2, 1400 / (faces.length + 40))}
                strokeLinejoin="round"
              />
            );
          })}
        </svg>
      </div>
      <div className="flex items-center gap-3">
        <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
        <label className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
          Explode
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={explode}
            onChange={(e) => setExplode(Number(e.target.value))}
            className="flex-1"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setYaw(35);
            setPitch(-28);
            setExplode(0);
          }}
          className="text-xs text-muted-foreground underline"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
