"use client";

import { useMemo, useRef } from "react";
import { Download } from "lucide-react";
import { renderBlueprint } from "@/lib/blueprint/render";
import type { Plan } from "@/lib/plan/schema";
import type { Units } from "@/lib/types";

/** Full blueprint sheet (3 ortho views + iso + parts table) as inline SVG. */
export function BlueprintSheet({
  plan,
  units,
  highlightPartId,
}: {
  plan: Plan;
  units: Units;
  highlightPartId?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const svg = useMemo(
    () => renderBlueprint(plan, units, highlightPartId ?? undefined),
    [plan, units, highlightPartId]
  );

  const svgText = () => ref.current?.querySelector("svg")?.outerHTML ?? null;
  const slug = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

  function download(name: string, blob: Blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function saveSvg() {
    const t = svgText();
    if (t) download(`${slug}-blueprint.svg`, new Blob([t], { type: "image/svg+xml" }));
  }

  function savePng() {
    const t = svgText();
    if (!t) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 2200;
      c.height = 1560;
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b && download(`${slug}-blueprint.png`, b), "image/png");
    };
    img.src = URL.createObjectURL(new Blob([t], { type: "image/svg+xml" }));
  }

  return (
    <div>
      <div className="mb-2 flex justify-end gap-2">
        <button
          onClick={saveSvg}
          className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <Download className="h-3 w-3" /> SVG
        </button>
        <button
          onClick={savePng}
          className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <Download className="h-3 w-3" /> PNG
        </button>
      </div>
      <div
        ref={ref}
        className="overflow-hidden rounded-md [&_svg]:block [&_svg]:w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
