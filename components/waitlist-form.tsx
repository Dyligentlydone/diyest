"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { toast } from "sonner";
import { Check } from "lucide-react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; theme?: string; callback?: (t: string) => void }
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

export function WaitlistForm({ siteKey }: { siteKey: string | null }) {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [build, setBuild] = useState("");
  const [heard, setHeard] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    alreadyJoined: boolean;
    confirmed: boolean;
  } | null>(null);
  const tokenRef = useRef<string | null>(null);
  const widgetEl = useRef<HTMLDivElement>(null);

  // render the Turnstile widget once the script is ready
  useEffect(() => {
    if (!siteKey || !widgetEl.current) return;
    const render = () => {
      if (window.turnstile && widgetEl.current)
        window.turnstile.render(widgetEl.current, {
          sitekey: siteKey,
          callback: (t) => {
            tokenRef.current = t;
          },
        });
    };
    if (window.turnstile) render();
    else {
      const t = setInterval(() => {
        if (window.turnstile) {
          clearInterval(t);
          render();
        }
      }, 300);
      return () => clearInterval(t);
    }
  }, [siteKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          buildAnswer: build || undefined,
          heardFrom: heard || undefined,
          marketingOptIn: marketing,
          turnstileToken: tokenRef.current ?? undefined,
          ref: params.get("ref") ?? undefined,
          invite: params.get("invite") ?? undefined,
          utmSource: params.get("utm_source") ?? undefined,
          utmMedium: params.get("utm_medium") ?? undefined,
          utmCampaign: params.get("utm_campaign") ?? undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        alreadyJoined?: boolean;
        confirmed?: boolean;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Something went wrong — try again.");
        window.turnstile?.reset();
        return;
      }
      setDone({ alreadyJoined: !!data.alreadyJoined, confirmed: !!data.confirmed });
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <Check className="mx-auto h-8 w-8 text-green-600" aria-hidden />
        <h3 className="mt-3 font-semibold">
          {done.confirmed
            ? "You're already on the list"
            : "Check your inbox"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {done.confirmed
            ? "This email is already confirmed — we'll send your invite soon."
            : "Click the confirmation link we just sent to lock in your spot."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border bg-card p-5 text-left">
      {siteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="lazyOnload"
        />
      )}
      <label className="block text-sm font-medium" htmlFor="wl-email">
        Email
      </label>
      <input
        id="wl-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="mt-1 h-11 w-full rounded-md border bg-transparent px-3 text-base outline-none focus:border-primary sm:h-10 sm:text-sm"
      />
      <label className="mt-4 block text-sm font-medium" htmlFor="wl-build">
        What do you want to build first? <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id="wl-build"
        type="text"
        value={build}
        onChange={(e) => setBuild(e.target.value)}
        placeholder="A bookcase, a desk, fix a wobbly chair…"
        maxLength={500}
        className="mt-1 h-11 w-full rounded-md border bg-transparent px-3 text-base outline-none focus:border-primary sm:h-10 sm:text-sm"
      />
      <label className="mt-4 block text-sm font-medium" htmlFor="wl-heard">
        How did you hear about us? <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id="wl-heard"
        type="text"
        value={heard}
        onChange={(e) => setHeard(e.target.value)}
        placeholder="YouTube, a friend, Reddit…"
        maxLength={200}
        className="mt-1 h-11 w-full rounded-md border bg-transparent px-3 text-base outline-none focus:border-primary sm:h-10 sm:text-sm"
      />
      <label className="mt-4 flex items-start gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={marketing}
          onChange={(e) => setMarketing(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border"
        />
        Send me DIY tips and product updates (optional — waitlist emails either way)
      </label>
      {siteKey && <div ref={widgetEl} className="cf-turnstile mt-4" />}
      <button
        type="submit"
        disabled={busy}
        className="mt-5 h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {busy ? "Joining…" : "Join the waitlist"}
      </button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Have an invite code?{" "}
        <Link href="/invite" className="underline underline-offset-2">
            Redeem it
          </Link>
      </p>
    </form>
  );
}
