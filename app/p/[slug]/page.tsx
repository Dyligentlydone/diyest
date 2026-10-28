import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanView } from "@/components/plan/plan-view";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isSupabaseConfigured } from "@/lib/env";
import { betaAccessFor, isInviteOnly } from "@/lib/site-mode";
import { planSchema } from "@/lib/plan/schema";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/connect";
import { BuyPlanButton } from "@/components/buy-plan-button";
import { ProjectThumb } from "@/components/project-thumb";
import { CloneButton } from "./clone-button";
import { PurchasePending } from "./purchase-pending";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ bought?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isSupabaseConfigured()) return {};
  const { slug } = await params;
  // service client: paid plans are RLS-invisible to anon but still need OG
  const supabase = createServiceClient();
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

async function PublicContent({ params, searchParams }: Props) {
  const { slug } = await params;
  const { bought } = await searchParams;
  const service = createServiceClient();
  const supabase = await createClient();
  const [{ data: project }, { data: auth }] = await Promise.all([
    service
      .from("projects")
      .select(
        "id, title, plan, input, is_public, slug, category, user_id, price_cents"
      )
      .eq("slug", slug)
      .eq("is_public", true)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!project) notFound();
  const parsed = planSchema.safeParse(project.plan);
  if (!parsed.success) notFound();
  const plan = parsed.data;

  const isOwner = auth.user?.id === project.user_id;
  const isPaid = !!project.price_cents;

  let purchase: { cloned_project_id: string | null } | null = null;
  if (isPaid && auth.user && !isOwner) {
    const { data } = await service
      .from("plan_purchases")
      .select("cloned_project_id")
      .eq("project_id", project.id)
      .eq("buyer_id", auth.user.id)
      .is("refunded_at", null)
      .maybeSingle();
    purchase = data;
  }
  const locked = isPaid && !isOwner && !purchase;

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
          {isPaid && purchase?.cloned_project_id ? (
            <Link
              href={`/projects/${purchase.cloned_project_id}`}
              className={buttonVariants()}
            >
              Open your copy
            </Link>
          ) : locked ? null : auth.user &&
            (!isInviteOnly() ||
              (await betaAccessFor(auth.user.id))?.active) ? (
            <CloneButton projectId={project.id} />
          ) : isInviteOnly() ? (
            <>
              <Link href="/#waitlist" className={buttonVariants()}>
                Join the waitlist
              </Link>
              <Link
                href="/invite"
                className={buttonVariants({ variant: "outline" })}
              >
                Have an invite code?
              </Link>
            </>
          ) : (
            <Link href={`/login?next=/p/${slug}`} className={buttonVariants()}>
              Build this yourself
            </Link>
          )}
        </div>
      </div>

      {locked ? (
        <div className="overflow-hidden rounded-lg border">
          <div className="bg-[#0b4f9c] p-4">
            <div className="mx-auto max-w-md [&>svg]:h-64 [&>svg]:w-full">
              <ProjectThumb plan={plan} />
            </div>
          </div>
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-xl font-bold">{project.title}</h1>
              <span className="text-lg font-semibold">
                {formatCents(project.price_cents!)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{plan.summary}</p>
            <p className="text-xs text-muted-foreground">
              {plan.difficulty} · ~{plan.est_hours}h build · est. materials $
              {plan.est_cost.low}–${plan.est_cost.high} · {plan.steps.length}{" "}
              steps · blueprint + cut list + shopping list
            </p>
            {bought === "1" ? <PurchasePending /> : null}
            <div className="flex items-center gap-3">
              {auth.user ? (
                <BuyPlanButton
                  projectId={project.id}
                  slug={slug}
                  priceLabel={formatCents(project.price_cents!)}
                />
              ) : (
                <Link
                  href={`/login?next=/p/${slug}`}
                  className={buttonVariants({ size: "lg" })}
                >
                  Sign in to buy — {formatCents(project.price_cents!)}
                </Link>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Sold by the plan&apos;s creator. Instant copy into your projects —
              blueprint, cut list, shopping list and steps included.
            </p>
          </div>
        </div>
      ) : (
        <>
          {isPaid && purchase && (
            <p className="mb-4 rounded-md border px-4 py-3 text-sm">
              You own this plan — it&apos;s also in{" "}
              <Link href="/projects" className="underline">
                My projects
              </Link>
              .
            </p>
          )}
          <PlanView plan={plan} units={units} />
        </>
      )}

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
        <PublicContent params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
