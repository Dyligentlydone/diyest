"use client";

import { useMemo, useRef, useState } from "react";
import { Box, ZoomIn, ZoomOut } from "lucide-react";
import type { Plan } from "@/lib/plan/schema";
import { solidsOf } from "@/lib/blueprint/solids";
import { explodeSolids, projectTurntable } from "@/lib/blueprint/explode";

const r1 = (x: number) => x.toFixed(1);

// Open on the same corner the blueprint sheet's ISOMETRIC VIEW uses:
// the sheet views from (−x, +y, −z) at ~35° elevation, which in turntable
// terms is yaw 145, pitch 35. Fixed — not heuristic — so the preview is
// always consistent with the drawing right above it, whatever the model
// placed on each side.
const HOME = { yaw: 145, pitch: 35 };
// keep the camera above floor level and below a pure top-down so the piece
// never reads upside-down or sideways
const PITCH_MIN = -5;
const PITCH_MAX = 80;

/**
 * Interactive 3D preview built from the plan's actual geometry — no WebGL:
 * rotate by dragging (turntable camera), zoom, pull apart with the explode
 * slider. Faces are painter-sorted so occlusion is correct without a depth
 * buffer.
 */
export function Preview3D({ plan }: { plan: Plan }) {
  const solids = useMemo(() => solidsOf(plan), [plan]);
  // null = sitting at the home angle
  const [rot, setRot] = useState<{ yaw: number; pitch: number } | null>(null);
  const yaw = rot?.yaw ?? HOME.yaw;
  const pitch = rot?.pitch ?? HOME.pitch;
  const [zoom, setZoom] = useState(1);
  const [explode, setExplode] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const faces = useMemo(
    () =>
      projectTurntable(
        explode > 0 ? explodeSolids(solids, explode * 0.3) : solids,
        yaw,
        pitch,
        true // mirror to match the sheet's isometric handedness
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
    if (!faces.length) return "0 0 1 1";
    // zoom by shrinking/expanding the viewBox around its center
    const cx = (u0 + u1) / 2,
      cy = (v0 + v1) / 2;
    const w = Math.max(u1 - u0, 1) / zoom,
      h = Math.max(v1 - v0, 1) / zoom;
    const pad = Math.max(w, h) * 0.08 + 1;
    return `${r1(cx - w / 2 - pad)} ${r1(-cy - h / 2 - pad)} ${r1(w + pad * 2)} ${r1(
      h + pad * 2
    )}`;
  }, [faces, zoom]);

  if (!solids.length) return null;

  return (
    <div className="space-y-2">
      <div
        className="cursor-grab touch-none select-none overflow-hidden rounded-md border bg-[#0b4f9c] active:cursor-grabbing"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          setRot({
            // mirrored view — reverse dx so dragging still follows the grab
            yaw: yaw - dx * 0.4,
            pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch + dy * 0.4)),
          });
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        role="img"
        aria-label={`3D preview of ${plan.title} — drag to rotate`}
      >
        <svg viewBox={view} className="h-72 w-full sm:h-96">
          {faces.map((f, i) => {
            const l = Math.round(255 - f.shade * 140);
            return (
              <polygon
                key={i}
                points={f.pts.map((q) => `${r1(q[0])},${r1(-q[1])}`).join(" ")}
                fill={`rgb(${Math.round(l * 0.55)},${Math.round(l * 0.75)},${l})`}
                stroke="#eaf3ff"
                strokeWidth={Math.max(1.5, 900 / (faces.length + 40))}
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
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}
          className="text-muted-foreground hover:text-foreground"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
          className="text-muted-foreground hover:text-foreground"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setRot(null);
            setZoom(1);
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
