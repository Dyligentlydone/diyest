"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { WaitlistForm } from "@/components/waitlist-form";
import { InviteForm } from "@/app/invite/invite-form";

const GATE_COOKIE = "diyest_gate";

/**
 * Full-screen lock over the homepage. Anonymous visitors can't click around
 * until they either join the waitlist (unlocks browsing via a cookie — the
 * API still blocks generation) or redeem an invite code (real access).
 * The server decides whether to render this — it's a UX gate, not security.
 */
export function InviteLock({ siteKey }: { siteKey: string | null }) {
  const [open, setOpen] = useState(true);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  if (!open) return null;

  if (joined)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center">
          <Check className="mx-auto h-10 w-10 text-green-600" aria-hidden />
          <h2 className="mt-4 text-xl font-semibold">You&apos;re on the list</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Check your inbox to confirm your spot. In the meantime, take a look
            around — plan generation unlocks with an invite code.
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-6 h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Take a look around
          </button>
        </div>
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="diyest is invite-only"
    >
      <div className="w-full max-w-md text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="diyest" className="mx-auto h-16 w-auto" />
        <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4" aria-hidden />
          diyest is in invite-only beta
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Join the waitlist to look around — or enter an invite code for{" "}
          <strong>3 plan generations</strong>.
        </p>
        <div className="mt-6 text-left">
          <WaitlistForm
            siteKey={siteKey}
            onJoined={() => {
              // belt-and-braces: the API also sets it on the response
              document.cookie = `${GATE_COOKIE}=waitlist; path=/; max-age=31536000; samesite=lax`;
              setJoined(true);
            }}
          />
        </div>
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Have an invite code?
          </p>
          <InviteForm />
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
