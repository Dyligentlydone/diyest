import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { planSchema } from "@/lib/plan/schema";
import { createClient } from "@/lib/supabase/server";
import { isInviteOnly } from "@/lib/site-mode";
import { ProjectThumb } from "@/components/project-thumb";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Project gallery — free DIY plans with blueprints | diyest",
  description:
    "Browse real buildable plans — tables, shelves, storage, outdoor projects and more. Every plan includes a measured blueprint, cut list, shopping list and steps.",
};

const CATEGORIES = [
  "tables",
  "shelves",
  "storage",
  "outdoor",
  "kids",
  "seating",
  "desks",
  "other",
] as const;

async function GalleryGrid() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, slug, category, plan")
    .eq("is_public", true)
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);

  if (!projects?.length)
    return (
      <div className="mt-12 rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nothing shared yet — be the first to publish a plan.
      </div>
    );

  return (
    <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {projects.map((p) => {
        const parsed = planSchema.safeParse(p.plan);
        return (
          <li key={p.id}>
            <Link
              href={`/p/${p.slug}`}
              className="block overflow-hidden rounded-lg border transition-colors hover:bg-accent"
            >
              <div className="bg-[#0b4f9c] p-2">
                {parsed.success ? (
                  <div className="[&>svg]:h-28 [&>svg]:w-full">
                    <ProjectThumb plan={parsed.data} />
                  </div>
                ) : (
                  <div className="h-28" />
                )}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-medium">{p.title}</p>
                {p.category && (
                  <Badge variant="secondary" className="mt-1.5 text-[10px] capitalize">
                    {p.category}
                  </Badge>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function GalleryPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold">Project gallery</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Free plans shared by builders — blueprint, cut list, shopping list and
        steps included.{" "}
        {isInviteOnly()
          ? "Open one and join the waitlist to build it."
          : "Open one and hit “Build this yourself” to make it yours."}
      </p>
      {isInviteOnly() && (
        <div className="mt-4 flex gap-2">
          <Link
            href="/#waitlist"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Join the waitlist
          </Link>
          <Link
            href="/invite"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Have an invite code?
          </Link>
        </div>
      )}

      <nav className="mt-5 flex flex-wrap gap-2" aria-label="Categories">
        <Link
          href="/gallery"
          className="rounded-full border bg-primary px-3 py-1 text-xs text-primary-foreground"
        >
          All
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/gallery/${c}`}
            className="rounded-full border px-3 py-1 text-xs capitalize text-muted-foreground hover:bg-muted"
          >
            {c}
          </Link>
        ))}
      </nav>

      {isSupabaseConfigured() ? (
        <Suspense
          fallback={
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-lg border bg-muted/40" />
              ))}
            </div>
          }
        >
          <GalleryGrid />
        </Suspense>
      ) : (
        <div className="mt-12 rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Connect Supabase to browse shared plans.
        </div>
      )}
    </main>
  );
}
