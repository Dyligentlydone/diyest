import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "My projects — diyest" };

async function ProjectList() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/projects");

  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, status, created_at")
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

  return (
    <ul className="mt-8 space-y-3">
      {projects.map((p) => (
        <li key={p.id}>
          <Link
            href={`/projects/${p.id}`}
            className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <span className="font-medium">{p.title}</span>
            <span className="text-sm capitalize text-muted-foreground">
              {p.status.replace("_", " ")}
            </span>
          </Link>
        </li>
      ))}
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
