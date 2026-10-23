"use client";

import { useState } from "react";
import { TOOL_CATEGORIES } from "@/lib/tools";

/**
 * Canonical tool checklist + free-text custom tools. Emits `tool` (multi) and
 * `tools_custom` (textarea) fields; the parent form submits them normally.
 */
export function ToolChecklist({
  defaultChecked = [],
  defaultCustom = "",
}: {
  defaultChecked?: string[];
  defaultCustom?: string;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(defaultChecked)
  );
  const toggle = (t: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-x-4 sm:grid-cols-2">
        {TOOL_CATEGORIES.map((cat) => (
          <fieldset key={cat.name} className="mb-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {cat.name}
            </legend>
            <div className="flex flex-wrap gap-1">
              {cat.tools.map((t) => (
                <label
                  key={t}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    checked.has(t)
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="tool"
                    value={t}
                    checked={checked.has(t)}
                    onChange={() => toggle(t)}
                    className="sr-only"
                  />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div>
        <label htmlFor="tools_custom" className="text-xs text-muted-foreground">
          Other tools not listed — one per line:
        </label>
        <textarea
          id="tools_custom"
          name="tools_custom"
          rows={2}
          defaultValue={defaultCustom}
          placeholder={"router table\nlathe"}
          className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}

/** Parse the FormData this component emits into a tools array. */
export function toolsFromFormData(fd: FormData): string[] {
  const custom = String(fd.get("tools_custom") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...fd.getAll("tool").map(String), ...custom];
}
