import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { PartyPopper, TicketX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { checkCode, lookupCode, redeemCode, REDEEM_BLOCK_COPY } from "@/lib/invite";

export const metadata: Metadata = {
  title: "Redeem invite — diyest",
  robots: { index: false },
};

function Blocked({ reason }: { reason: string }) {
  return (
    <>
      <TicketX className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-2xl font-bold">Invite problem</h1>
      <p className="mt-2 text-sm text-muted-foreground">{reason}</p>
      <Link href="/#waitlist" className={`${buttonVariants()} mt-6`}>
        Join the waitlist instead
      </Link>
    </>
  );
}

async function Redeem({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.trim().toUpperCase();

  const row = await lookupCode(code);
  const check = checkCode(row);
  if (!check.ok) return <Blocked reason={REDEEM_BLOCK_COPY[check.error]} />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <PartyPopper className="h-10 w-10 text-primary" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold">Your invite is ready</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Code <strong className="font-mono">{code}</strong> — sign in to claim it.
          Your invite includes <strong>3 plan generations</strong>.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/invite/${code}`)}`}
          className={`${buttonVariants()} mt-6`}
        >
          Sign in to claim
        </Link>
      </>
    );
  }

  const result = await redeemCode(user.id, code);
  if (!result.ok) return <Blocked reason={REDEEM_BLOCK_COPY[result.error]} />;

  return (
    <>
      <PartyPopper className="h-10 w-10 text-primary" aria-hidden />
      <h1 className="mt-4 text-2xl font-bold">Welcome to the beta</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <strong className="capitalize">{result.level}</strong> access unlocked —
        your invite includes <strong>3 plan generations</strong>. Snap a photo
        or describe a project and get a buildable plan.
      </p>
      <Link href="/new" className={`${buttonVariants()} mt-6`}>
        Start your first project
      </Link>
    </>
  );
}

export default function InvitePage(props: { params: Promise<{ code: string }> }) {
  if (!isSupabaseConfigured())
    return (
      <main className="flex flex-1 flex-col items-center px-4 py-20 text-center">
        <Blocked reason="Sign-in isn't configured yet." />
      </main>
    );
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-20 text-center">
      <Suspense fallback={<div className="h-40 w-64 animate-pulse rounded-lg border bg-muted/40" />}>
        <Redeem params={props.params} />
      </Suspense>
    </main>
  );
}
