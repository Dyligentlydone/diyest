"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Globe, Link2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

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

const fmt = (cents: number) =>
  `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

export function ShareToggle({
  projectId,
  isPublic,
  slug,
  category,
  priceCents,
  canCharge,
}: {
  projectId: string;
  isPublic: boolean;
  slug: string | null;
  category: string | null;
  priceCents: number | null;
  /** creator has finished Stripe Connect onboarding */
  canCharge: boolean;
}) {
  const [pub, setPub] = useState(isPublic);
  const [cat, setCat] = useState(category ?? "other");
  const [curSlug, setCurSlug] = useState(slug);
  const [busy, setBusy] = useState(false);
  const [priced, setPriced] = useState(!!priceCents);
  const [listedCents, setListedCents] = useState(priceCents);
  const [dollars, setDollars] = useState(
    priceCents ? (priceCents / 100).toString() : "10"
  );

  async function share() {
    const cents = Math.round(Number(dollars) * 100);
    if (priced && (!Number.isFinite(cents) || cents < 100)) {
      toast.error("Price must be at least $1");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          is_public: true,
          category: cat,
          price_cents: priced ? cents : null,
        }),
      });
      const data = await res.json();
      if (data.error === "connect_payouts") {
        toast.error("Set up payouts in Settings before charging");
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't share");
      setPub(true);
      setCurSlug(data.project.slug);
      setListedCents(data.project.price_cents ?? null);
      const url = `${location.origin}/p/${data.project.slug}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success(priced ? "Listed for sale — link copied" : "Public link copied");
      } catch {
        toast.success(`Shared: ${url}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unshare() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_public: false }),
      });
      if (!res.ok) throw new Error("Couldn't unshare");
      setPub(false);
      toast.success("Project is private again");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (pub && curSlug)
    return (
      <span className="flex items-center gap-2">
        {listedCents ? (
          <span className="text-xs font-medium text-muted-foreground">
            Listed at {fmt(listedCents)}
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `${location.origin}/p/${curSlug}`
              );
              toast.success("Link copied");
            } catch {
              toast.info(`${location.origin}/p/${curSlug}`);
            }
          }}
        >
          <Link2 className="mr-1.5 h-3.5 w-3.5" /> Copy link
        </Button>
        <button
          type="button"
          onClick={unshare}
          disabled={busy}
          className="text-xs text-muted-foreground underline"
        >
          make private
        </button>
      </span>
    );

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        value={cat}
        onChange={(e) => setCat(e.target.value as (typeof CATEGORIES)[number])}
        className="h-8 rounded border bg-transparent px-1.5 text-xs capitalize"
        aria-label="Gallery category"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c} className="capitalize">
            {c}
          </option>
        ))}
      </select>
      <span className="flex items-center overflow-hidden rounded border text-xs">
        <button
          type="button"
          onClick={() => setPriced(false)}
          className={`px-2 py-1.5 ${!priced ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Free
        </button>
        <button
          type="button"
          onClick={() => {
            if (!canCharge) {
              toast.error("Set up payouts in Settings first");
              return;
            }
            setPriced(true);
          }}
          className={`px-2 py-1.5 ${priced ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          title={canCharge ? undefined : "Connect payouts in Settings first"}
        >
          Paid
        </button>
      </span>
      {priced && (
        <span className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">$</span>
          <input
            type="number"
            min="1"
            step="0.01"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            className="h-8 w-20 rounded border bg-transparent px-1.5"
            aria-label="Price in dollars"
          />
        </span>
      )}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={share}>
        {pub ? <Globe className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
        {busy ? "Sharing…" : priced ? "List for sale" : "Share publicly"}
      </Button>
      {!canCharge && (
        <Link href="/settings" className="text-xs text-muted-foreground underline">
          set up payouts to charge
        </Link>
      )}
    </span>
  );
}
