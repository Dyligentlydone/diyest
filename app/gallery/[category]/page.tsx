import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { planSchema } from "@/lib/plan/schema";
import { createServiceClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/connect";
import { ProjectThumb } from "@/components/project-thumb";
import { Badge } from "@/components/ui/badge";

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
type Category = (typeof CATEGORIES)[number];

const SEO_BLURB: Record<Category, string> = {
  tables: "DIY table plans — coffee tables, side tables, dining tables with measured blueprints, cut lists and step-by-step instructions.",
  shelves: "DIY shelving plans — bookcases, floating shelves, wall storage with measured blueprints and shopping lists.",
  storage: "DIY storage plans — boxes, cabinets, organizers with measured blueprints and step-by-step instructions.",
  outdoor: "Outdoor DIY plans — planters, benches, birdhouses and garden furniture with measured blueprints.",
  kids: "DIY plans for kids' rooms — toy boxes, step stools, small furniture with safety-checked instructions.",
  seating: "DIY seating plans — benches, stools and chairs with measured blueprints and cut lists.",
  desks: "DIY desk plans — standing desks, computer desks, workspaces with measured blueprints and steps.",
  other: "More DIY plans — every project includes a blueprint, cut list, shopping list and step-by-step instructions.",
};

interface Props {
  params: Promise<{ category: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  if (!CATEGORIES.includes(category as Category)) return {};
  return {
    title: `DIY ${category} plans — free blueprints & cut lists | diyest`,
    description: SEO_BLURB[category as Category],
  };
}

async function CategoryGrid({ category }: { category: Category }) {
  // service client: paid plans are RLS-invisible to anon but should be listed
  const supabase = createServiceClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, slug, plan, price_cents")
    .eq("is_public", true)
    .eq("category", category)
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);

  if (!projects?.length)
    return (
      <div className="mt-12 rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        No {category} plans shared yet.
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
                {p.price_cents ? (
                  <Badge className="mt-1.5 text-[10px]">
                    {formatCents(p.price_cents)}
                  </Badge>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

async function CategoryBody({ params }: Props) {
  const { category } = await params;
  if (!CATEGORIES.includes(category as Category)) notFound();
  const cat = category as Category;

  return (
    <>
      <Link href="/gallery" className="text-sm text-muted-foreground hover:underline">
        ← Gallery
      </Link>
      <h1 className="mt-2 text-2xl font-bold capitalize">{cat} plans</h1>
      <p className="mt-1 text-sm text-muted-foreground">{SEO_BLURB[cat]}</p>

      {isSupabaseConfigured() ? (
        <CategoryGrid category={cat} />
      ) : (
        <div className="mt-12 rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Connect Supabase to browse shared plans.
        </div>
      )}
    </>
  );
}

export default function GalleryCategoryPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense
        fallback={
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-lg border bg-muted/40" />
            ))}
          </div>
        }
      >
        <CategoryBody params={props.params} />
      </Suspense>
    </main>
  );
}
