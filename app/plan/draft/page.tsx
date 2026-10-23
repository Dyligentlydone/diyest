import { Suspense } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { requirePageAccess } from "@/lib/site-mode";
import { createClient } from "@/lib/supabase/server";
import type { Units } from "@/lib/types";
import { DraftClient } from "./draft-client";

export const metadata = { title: "Your plan — diyest" , robots: { index: false } };

async function sessionInfo(): Promise<{
  isAuthed: boolean;
  units: Units;
  kerfMm: number;
}> {
  if (!isSupabaseConfigured())
    return { isAuthed: false, units: "metric", kerfMm: 3 };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { isAuthed: false, units: "metric", kerfMm: 3 };
  const { data: p } = await supabase
    .from("profiles")
    .select("units, kerf_mm")
    .eq("id", user.id)
    .maybeSingle();
  return {
    isAuthed: true,
    units: p?.units === "imperial" ? "imperial" : "metric",
    kerfMm: typeof p?.kerf_mm === "number" ? p.kerf_mm : 3,
  };
}

export default function DraftPlanPage() {
  return (
    <Suspense>
      <DraftLoader />
    </Suspense>
  );
}

async function DraftLoader() {
  // invite-only beta: drafts require an active invite
  await requirePageAccess("/plan/draft");
  const { isAuthed, units, kerfMm } = await sessionInfo();
  return <DraftClient isAuthed={isAuthed} units={units} kerfMm={kerfMm} />;
}
