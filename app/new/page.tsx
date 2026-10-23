import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { SkillLevel, Units } from "@/lib/types";
import { BuildForm } from "./build-form";
import { Suspense } from "react";

export const metadata = { title: "New project — diyest" };

const MODES = [
  { key: "build", label: "Build this", active: true },
  { key: "fix", label: "Fix it", active: false },
  { key: "space", label: "My space", active: false },
  { key: "leftovers", label: "Leftovers", active: false },
];

async function defaults(): Promise<{
  units: Units;
  skillLevel: SkillLevel;
  toolsOwned: string[];
}> {
  if (!isSupabaseConfigured())
    return { units: "metric", skillLevel: "beginner", toolsOwned: [] };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { units: "metric", skillLevel: "beginner", toolsOwned: [] };
  const { data: p } = await supabase
    .from("profiles")
    .select("units, skill_level, tools_owned")
    .eq("id", user.id)
    .maybeSingle();
  return {
    units: p?.units === "imperial" ? "imperial" : "metric",
    skillLevel: (p?.skill_level as SkillLevel) ?? "beginner",
    toolsOwned: (p?.tools_owned as string[] | null) ?? [],
  };
}

async function Form() {
  const d = await defaults();
  return <BuildForm defaults={d} />;
}

export default function NewProjectPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">New project</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Show diyest what you want to make — get back a plan you can build.
      </p>

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Entry mode">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={m.active}
            disabled={!m.active}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              m.active
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground opacity-60"
            }`}
          >
            {m.label}
            {!m.active && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                soon
              </Badge>
            )}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Build this</CardTitle>
          <CardDescription>
            Upload a photo or describe the piece. diyest works out the parts,
            joinery, shopping list and steps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <Form />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
