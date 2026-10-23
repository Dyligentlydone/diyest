import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings — diyest" };

async function SettingsContent() {
  if (!isSupabaseConfigured()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profile &amp; defaults</CardTitle>
          <CardDescription>
            Supabase is not configured yet — sign in and profile settings will
            appear here once it is.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings");

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const profile: Profile = (data as Profile | null) ?? {
    id: user.id,
    display_name: null,
    units: "metric",
    skill_level: "beginner",
    kerf_mm: 3,
    stock_sizes: {},
    tools_owned: [],
    plan_tier: "free",
    stripe_customer_id: null,
    created_at: "",
    updated_at: "",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile &amp; defaults</CardTitle>
        <CardDescription>
          These defaults are applied to every new plan you generate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsForm profile={profile} email={user.email ?? ""} />
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg border bg-muted/40" />}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
