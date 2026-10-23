import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Printer } from "lucide-react";
import { PlanView } from "@/components/plan/plan-view";
import { JournalSection, type JournalEntry } from "@/components/journal";
import { ShareToggle } from "./share-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
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
    .select(
      "id, title, status, plan, input, created_at, shopping_have, is_public, slug, category"
    )
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

  // done-steps seed build mode across devices
  const { data: progress } = await supabase
    .from("step_progress")
    .select("step_n")
    .eq("project_id", id)
    .eq("done", true);
  const serverDone = (progress ?? []).map((r) => r.step_n);

  // journal entries with signed photo URLs (private bucket)
  const { data: journal } = await supabase
    .from("journal_entries")
    .select("id, note, image_path, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  const entries: JournalEntry[] = await Promise.all(
    (journal ?? []).map(async (e) => {
      let imageUrl: string | null = null;
      if (e.image_path) {
        const { data: signed } = await supabase.storage
          .from("project-images")
          .createSignedUrl(e.image_path, 3600);
        imageUrl = signed?.signedUrl ?? null;
      }
      return {
        id: e.id,
        note: e.note,
        imageUrl,
        created_at: e.created_at,
      };
    })
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ShareToggle
          projectId={project.id}
          isPublic={project.is_public}
          slug={project.slug}
          category={project.category}
        />
        <Link
          href={`/projects/${project.id}/print`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Printer className="mr-1.5 h-3.5 w-3.5" /> Export PDF
        </Link>
      </div>

      <PlanView
        plan={parsed.data}
        units={units}
        kerfMm={typeof profile?.kerf_mm === "number" ? profile.kerf_mm : 3}
        projectId={project.id}
        serverHave={(project.shopping_have as string[] | null) ?? []}
        excludeMaterials={
          Array.isArray((project.input as Record<string, unknown>)?.materialsOwned)
            ? ((project.input as Record<string, unknown>)
                .materialsOwned as string[])
            : []
        }
        serverDone={serverDone}
      />

      <JournalSection projectId={project.id} entries={entries} />
    </div>
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
