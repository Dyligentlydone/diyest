import { Suspense } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Units } from "@/lib/types";
import { DraftClient } from "./draft-client";

export const metadata = { title: "Your plan — diyest" };

async function sessionInfo(): Promise<{ isAuthed: boolean; units: Units }> {
  if (!isSupabaseConfigured()) return { isAuthed: false, units: "metric" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { isAuthed: false, units: "metric" };
  const { data: p } = await supabase
    .from("profiles")
    .select("units")
    .eq("id", user.id)
    .maybeSingle();
  return { isAuthed: true, units: p?.units === "imperial" ? "imperial" : "metric" };
}

export default function DraftPlanPage() {
  return (
    <Suspense>
      <DraftLoader />
    </Suspense>
  );
}

async function DraftLoader() {
  const { isAuthed, units } = await sessionInfo();
  return <DraftClient isAuthed={isAuthed} units={units} />;
}
