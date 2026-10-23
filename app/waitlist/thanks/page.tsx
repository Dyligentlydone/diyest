import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { computePosition, type WaitlistEntry } from "@/lib/waitlist";
import { referralLink } from "@/lib/email";
import { CopyLink } from "./copy-link";

export const metadata: Metadata = {
  title: "You're on the list — diyest",
  robots: { index: false },
};

async function Position({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c: code } = await searchParams;
  if (!code) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        Check your inbox to confirm your email.
      </p>
    );
  }
  const supabase = createServiceClient();
  const { data: me } = await supabase
    .from("waitlist")
    .select("seq, referral_count, confirmed_at")
    .eq("referral_code", code)
    .maybeSingle();
  if (!me) return null;

  const { data: confirmed } = await supabase
    .from("waitlist")
    .select("seq, referral_count, confirmed_at")
    .not("confirmed_at", "is", null)
    .limit(10000);
  const pos = computePosition(me as WaitlistEntry, (confirmed ?? []) as WaitlistEntry[]);
  const link = referralLink(code);

  return (
    <>
      {pos > 0 && (
        <p className="mt-6 text-4xl font-bold tracking-tight">
          #<span className="tabular-nums">{pos}</span>
          <span className="mt-1 block text-base font-normal text-muted-foreground">
            in line
          </span>
        </p>
      )}
      <div className="mt-8 rounded-lg border p-5 text-left">
        <h2 className="font-semibold">Move up the line</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your link — every friend who confirms bumps you up 5 spots.
          {me.referral_count > 0 && (
            <>
              {" "}
              You&apos;ve referred <strong>{me.referral_count}</strong> so far.
            </>
          )}
        </p>
        <CopyLink link={link} />
      </div>
    </>
  );
}

export default function ThanksPage(props: {
  searchParams: Promise<{ c?: string }>;
}) {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">You&apos;re on the list</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We&apos;ll email your invite when a spot opens. Want it sooner?
      </p>
      {isSupabaseConfigured() ? (
        <Suspense>
          <Position searchParams={props.searchParams} />
        </Suspense>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          Check your inbox to confirm your email.
        </p>
      )}
      <Link href="/" className="mt-10 text-sm text-muted-foreground hover:underline">
        ← Back to diyest
      </Link>
    </main>
  );
}
