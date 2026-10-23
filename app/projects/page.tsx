import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectThumb } from "@/components/project-thumb";
import { isSupabaseConfigured } from "@/lib/env";
import { planSchema } from "@/lib/plan/schema";
import { createClient } from "@/lib/supabase/server";
import { StatusSelect } from "./status-select";

export const metadata = { title: "My projects — diyest" };

const MODE_LABEL: Record<string, string> = {
  build: "Build",
  describe: "Idea",
  fix: "Fix",
  space: "Space",
  leftovers: "Leftovers",
};

async function ProjectList() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/projects");

  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, mode, status, plan, created_at, is_public")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (!projects?.length) {
    return (
      <div className="mt-12 rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground">
          No projects yet. Generate your first plan from a photo or description.
        </p>
        <Link href="/new" className={buttonVariants({ className: "mt-4" })}>
          Build something
        </Link>
      </div>
    );
  }

  // % steps done per project
  const { data: progress } = await supabase
    .from("step_progress")
    .select("project_id, step_n, done")
    .in(
      "project_id",
      projects.map((p) => p.id)
    );
  const doneBy = new Map<string, number>();
  for (const row of progress ?? [])
    if (row.done)
      doneBy.set(row.project_id, (doneBy.get(row.project_id) ?? 0) + 1);

  return (
    <ul className="mt-8 space-y-3">
      {projects.map((p) => {
        const parsed = planSchema.safeParse(p.plan);
        const steps = parsed.success ? parsed.data.steps.length : 0;
        const done = doneBy.get(p.id) ?? 0;
        const pct = steps ? Math.round((done / steps) * 100) : 0;
        return (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
            >
              {parsed.success && <ProjectThumb plan={parsed.data} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px]">
                    {MODE_LABEL[p.mode] ?? p.mode}
                  </Badge>
                  {p.is_public && <span>shared</span>}
                  {steps > 0 && (
                    <span>
                      {done}/{steps} steps · {pct}%
                    </span>
                  )}
                  <span>
                    {new Date(p.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </span>
              </span>
              {/* progress bar */}
              {steps > 0 && (
                <span className="hidden w-24 sm:block">
                  <span className="block h-1.5 w-full rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </span>
              )}
              <StatusSelect projectId={p.id} status={p.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function ProjectsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My projects</h1>
        <Link href="/new" className={buttonVariants()}>
          New project
        </Link>
      </div>

      {!isSupabaseConfigured() ? (
        <div className="mt-12 rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            Connect Supabase (see{" "}
            <code className="font-mono text-sm">.env.example</code>) to save and
            list projects.
          </p>
        </div>
      ) : (
        <Suspense
          fallback={<div className="mt-12 h-40 animate-pulse rounded-lg border bg-muted/40" />}
        >
          <ProjectList />
        </Suspense>
      )}
    </main>
  );
}
