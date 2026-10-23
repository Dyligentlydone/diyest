import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PlanView } from "@/components/plan/plan-view";
import { Card, CardContent } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { planSchema } from "@/lib/plan/schema";
import { createClient } from "@/lib/supabase/server";
import type { Units } from "@/lib/types";

async function ProjectContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/projects/${id}`);

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, status, plan, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, kerf_mm")
    .eq("id", user.id)
    .maybeSingle();
  const units: Units = profile?.units === "imperial" ? "imperial" : "metric";

  const parsed = planSchema.safeParse(project.plan);
  if (!parsed.success) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          This project was saved with an older plan format and can&apos;t be displayed.
        </CardContent>
      </Card>
    );
  }

  return (
    <PlanView
      plan={parsed.data}
      units={units}
      kerfMm={typeof profile?.kerf_mm === "number" ? profile.kerf_mm : 3}
    />
  );
}

export default function ProjectPage(props: PageProps<"/projects/[id]">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link href="/projects" className="text-sm text-muted-foreground hover:underline">
        ← My projects
      </Link>
      <div className="mt-4">
        {!isSupabaseConfigured() ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Connect Supabase to view saved projects.
            </CardContent>
          </Card>
        ) : (
          <Suspense
            fallback={<div className="h-96 animate-pulse rounded-lg border bg-muted/40" />}
          >
            <ProjectContent params={props.params} />
          </Suspense>
        )}
      </div>
    </main>
  );
}
