import { Suspense } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { WaitlistForm } from "@/components/waitlist-form";
import { InviteLock } from "@/components/invite-lock";
import { hasBrowseCookie, isInviteOnly } from "@/lib/site-mode";
import { turnstileSiteKey } from "@/lib/turnstile";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ArrowRight, Camera, DraftingCompass, ListChecks, ShieldCheck } from "lucide-react";

function Notice({ kind }: { kind: string | null }) {
  if (kind === "required")
    return (
      <p className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        diyest is in invite-only beta — join the waitlist below, or{" "}
        <Link href="/invite" className="underline">redeem an invite code</Link>.
      </p>
    );
  if (kind === "invalid")
    return (
      <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
        That link didn&apos;t work — join the list again below.
      </p>
    );
  if (kind === "ok")
    return (
      <p className="mt-6 rounded-md border px-4 py-2 text-sm text-muted-foreground">
        You&apos;ve been unsubscribed from updates.
      </p>
    );
  return null;
}

async function Notices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <Notice kind={sp.invite ?? sp.confirm ?? (sp.unsub ? "ok" : null)} />;
}

function Transformation() {
  return (
    <div className="mt-10 grid items-center gap-3 sm:grid-cols-[1fr_auto_1.4fr]">
      <figure className="rounded-lg border bg-card p-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/examples/ldesk-photo.jpg"
          alt="A photo of a walnut L-shaped desk"
          className="w-full rounded"
        />
        <figcaption className="py-1.5 text-xs text-muted-foreground">
          You snap a photo
        </figcaption>
      </figure>
      <ArrowRight className="mx-auto h-6 w-6 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden />
      <figure className="rounded-lg border bg-card p-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/examples/ldesk-blueprint.png"
          alt="The generated dimensioned blueprint of the L-shaped desk"
          className="w-full rounded"
        />
        <figcaption className="py-1.5 text-xs text-muted-foreground">
          We draw the plan
        </figcaption>
      </figure>
    </div>
  );
}

const STEPS = [
  {
    icon: Camera,
    title: "Show it what you want",
    body: "A photo, a sketch, a broken chair, or just words.",
  },
  {
    icon: DraftingCompass,
    title: "Get real drawings",
    body: "A dimensioned blueprint from the actual geometry — not a guess.",
  },
  {
    icon: ListChecks,
    title: "Cut, shop, build",
    body: "Cut layout, shopping list and numbered steps matched to your tools.",
  },
  {
    icon: ShieldCheck,
    title: "Carpenter-checked",
    body: "Every plan is reviewed by a second model for buildability and safety.",
  },
];

const EXAMPLES = [
  { src: "/examples/ldesk-blueprint.png", alt: "Generated blueprint for an L-shaped desk", label: "L-shaped desk" },
  { src: "/examples/table-blueprint.png", alt: "Generated blueprint for a round table", label: "Round table" },
  { src: "/examples/bookcase-blueprint.png", alt: "Generated blueprint for a bookcase", label: "Bookcase" },
  { src: "/examples/ldesk-3d.png", alt: "3D preview of the L-shaped desk plan", label: "3D preview" },
];

/**
 * Show the lock screen when: invite-only mode AND the visitor hasn't joined
 * the waitlist (no browse cookie) AND isn't signed in. Signed-in users and
 * waitlisted browsers see the normal page. Runtime data (cookies/auth) must
 * stay inside a Suspense boundary so the page can still prerender.
 */
async function MaybeLock() {
  if (!isInviteOnly() || !isSupabaseConfigured()) return null;
  if (await hasBrowseCookie()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return null;
  return <InviteLock siteKey={turnstileSiteKey()} />;
}

export default function Home(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const inviteOnly = isInviteOnly();
  return (
    <main className="flex-1">
      <Suspense>
        <MaybeLock />
      </Suspense>
      <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-16 pb-10 text-center sm:pt-24">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="diyest" className="h-24 w-auto sm:h-32" />
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-5xl">
          Snap a photo. Get a plan you can actually build.
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
          diyest turns a picture or a description into a complete woodworking
          plan: measured drawings, a materials and cut list, and step-by-step
          instructions matched to your skill level and tools.
        </p>
        <Suspense>
          <Notices searchParams={props.searchParams} />
        </Suspense>
        <Transformation />
      </section>

      <section className="border-t">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.title}>
              <s.icon className="h-6 w-6" aria-hidden />
              <h2 className="mt-3 font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-xl font-bold">Real plans, real blueprints</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every example below was generated from a photo or a sentence.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {EXAMPLES.map((ex) => (
              <Link key={ex.src} href="/gallery" className="group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ex.src}
                  alt={ex.alt}
                  className="aspect-square w-full rounded-lg border object-cover transition-opacity group-hover:opacity-90"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">{ex.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="waitlist" className="border-t bg-muted/30 scroll-mt-16">
        <div className="mx-auto max-w-md px-4 py-14 text-center">
          {inviteOnly ? (
            <>
              <h2 className="text-2xl font-bold">Get early access</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We&apos;re opening the beta in waves. Join the list — referrals move
                you up the line.
              </p>
              <div className="mt-6">
                <Suspense fallback={<div className="h-80 animate-pulse rounded-lg border bg-card" />}>
                  <WaitlistForm siteKey={turnstileSiteKey()} />
                </Suspense>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold">Start building</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Free to try — no account needed for your first plan.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Link href="/new" className={buttonVariants({ size: "lg" })}>
                  Start a project
                </Link>
                <Link href="/gallery" className={buttonVariants({ size: "lg", variant: "outline" })}>
                  Browse plans
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
