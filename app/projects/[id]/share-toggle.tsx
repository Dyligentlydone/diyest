"use client";

import { useState } from "react";
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

export function ShareToggle({
  projectId,
  isPublic,
  slug,
  category,
}: {
  projectId: string;
  isPublic: boolean;
  slug: string | null;
  category: string | null;
}) {
  const [pub, setPub] = useState(isPublic);
  const [cat, setCat] = useState(category ?? "other");
  const [curSlug, setCurSlug] = useState(slug);
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_public: true, category: cat }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't share");
      setPub(true);
      setCurSlug(data.project.slug);
      const url = `${location.origin}/p/${data.project.slug}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Public link copied");
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
    <span className="flex items-center gap-2">
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
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={share}>
        {pub ? <Globe className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
        {busy ? "Sharing…" : "Share publicly"}
      </Button>
    </span>
  );
}
