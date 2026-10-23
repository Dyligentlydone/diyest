"use client";

import { useMemo } from "react";
import { renderBlueprint } from "@/lib/blueprint/render";
import type { Plan } from "@/lib/plan/schema";
import type { Units } from "@/lib/types";

/** Full blueprint sheet (3 ortho views + iso + parts table) as inline SVG. */
export function BlueprintSheet({ plan, units }: { plan: Plan; units: Units }) {
  const svg = useMemo(() => renderBlueprint(plan, units), [plan, units]);
  return (
    <div
      className="overflow-hidden rounded-md [&_svg]:block [&_svg]:w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
