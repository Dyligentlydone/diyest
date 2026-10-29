import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PlanView } from "@/components/plan/plan-view";
import { planSchema } from "@/lib/plan/schema";
import { createServiceClient } from "@/lib/supabase/server";

export const metadata = { robots: { index: false } };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;

  const supabase = createServiceClient();
  const { data: project } = await supabase
    .from("projects")
    .select("title, plan")
    .eq("id", id)
    .maybeSingle();
  const parsed = project ? planSchema.safeParse(project.plan) : null;
  if (!parsed?.success) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
        Dev preview — renders any saved project&apos;s plan without auth. Only
        exists when NODE_ENV=development.
      </p>
      <PlanView plan={parsed.data} units="metric" />
    </main>
  );
}

/** Local-only plan preview: renders any saved project's plan without auth. */
export default function DevPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-4 py-8">Loading…</main>}>
      <Content params={params} />
    </Suspense>
  );
}
