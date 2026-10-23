import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanView } from "@/components/plan/plan-view";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isSupabaseConfigured } from "@/lib/env";
import { planSchema } from "@/lib/plan/schema";
import { createClient } from "@/lib/supabase/server";
import { CloneButton } from "./clone-button";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isSupabaseConfigured()) return {};
  const { slug } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("title, plan")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();
  if (!project) return {};
  const title = `How to build: ${project.title} — diyest`;
  const description =
    (project.plan as { summary?: string })?.summary ??
    "A complete DIY plan — blueprint, cut list, shopping list and steps.";
  return {
    title,
    description,
    openGraph: { title, description },
  };
}

async function PublicContent({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const [{ data: project }, { data: auth }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, plan, input, is_public, slug, category, user_id")
      .eq("slug", slug)
      .eq("is_public", true)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!project) notFound();
  const parsed = planSchema.safeParse(project.plan);
  if (!parsed.success) notFound();
  const plan = parsed.data;

  const { data: journal } = await supabase
    .from("journal_entries")
    .select("id, note, image_path, created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(20);
  const journalWithUrls = await Promise.all(
    (journal ?? []).map(async (e) => {
      let imageUrl: string | null = null;
      if (e.image_path) {
        const { data: signed } = await supabase.storage
          .from("project-images")
          .createSignedUrl(e.image_path, 3600);
        imageUrl = signed?.signedUrl ?? null;
      }
      return { ...e, imageUrl };
    })
  );

  const units =
    ((project.input as Record<string, unknown>)?.units as string) === "imperial"
      ? "imperial"
      : "metric";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Shared diyest plan
          </p>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {project.category && (
              <Badge variant="secondary" className="capitalize">
                {project.category}
              </Badge>
            )}
            Built with diyest — an AI plan, verify before cutting.
          </p>
        </div>
        <div className="flex gap-2">
          {auth.user ? (
            <CloneButton projectId={project.id} />
          ) : (
            <Link href={`/login?next=/p/${slug}`} className={buttonVariants()}>
              Build this yourself
            </Link>
          )}
        </div>
      </div>

      <PlanView plan={plan} units={units} />

      {journalWithUrls.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Build journal</h2>
          <ol className="relative space-y-4 border-l pl-5">
            {journalWithUrls.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                <p className="text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                {e.note && <p className="mt-0.5 text-sm">{e.note}</p>}
                {e.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.imageUrl}
                    alt="Build progress"
                    className="mt-2 max-h-56 rounded-md border object-cover"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

export default function PublicProjectPage(props: Props) {
  if (!isSupabaseConfigured()) notFound();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <Suspense
        fallback={<div className="h-96 animate-pulse rounded-lg border bg-muted/40" />}
      >
        <PublicContent params={props.params} />
      </Suspense>
    </main>
  );
}
