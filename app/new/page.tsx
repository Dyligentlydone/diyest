import { isSupabaseConfigured } from "@/lib/env";
import { requirePageAccess } from "@/lib/site-mode";
import { createClient } from "@/lib/supabase/server";
import type { SkillLevel, Units } from "@/lib/types";
import { ModeTabs } from "./mode-tabs";
import { Suspense } from "react";

export const metadata = { title: "New project — diyest" , robots: { index: false } };

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
  // invite-only beta: /new requires an active invite
  await requirePageAccess();
  const d = await defaults();
  return <ModeTabs defaults={d} />;
}

export default function NewProjectPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">New project</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Show diyest what you want to make — get back a plan you can build.
      </p>

      <Suspense>
        <Form />
      </Suspense>
    </main>
  );
}
