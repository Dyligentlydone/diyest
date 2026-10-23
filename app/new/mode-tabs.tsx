"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SkillLevel, Units } from "@/lib/types";
import { BuildForm, MODE_COPY, type EntryMode } from "./build-form";

const MODES: { key: EntryMode }[] = [
  { key: "build" },
  { key: "describe" },
  { key: "fix" },
  { key: "space" },
  { key: "leftovers" },
];

export function ModeTabs({
  defaults,
}: {
  defaults: { units: Units; skillLevel: SkillLevel; toolsOwned: string[] };
}) {
  const [mode, setMode] = useState<EntryMode>("build");
  const copy = MODE_COPY[mode];

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Entry mode">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => setMode(m.key)}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              mode === m.key
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {MODE_COPY[m.key].title}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.desc}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* remount per mode so mode-specific state doesn't leak across tabs */}
          <BuildForm key={mode} defaults={defaults} mode={mode} />
        </CardContent>
      </Card>
    </>
  );
}
