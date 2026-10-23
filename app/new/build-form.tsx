"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compressImage } from "@/lib/images";
import { toMm } from "@/lib/units";
import type { SkillLevel, Units } from "@/lib/types";

const DRAFT_KEY = "diyest_draft_plan";
const PENDING_KEY = "diyest_pending_gen";

export function BuildForm({
  defaults,
}: {
  defaults: { units: Units; skillLevel: SkillLevel; toolsOwned: string[] };
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>([]); // compressed data URLs
  const [units, setUnits] = useState<Units>(defaults.units);
  const [useMyToolsOnly, setUseMyToolsOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPickImages(files: FileList | null) {
    if (!files?.length) return;
    const room = 4 - images.length;
    const picked = [...files].slice(0, room);
    for (const f of picked) {
      try {
        const dataUrl = await compressImage(f);
        setImages((prev) => (prev.length < 4 ? [...prev, dataUrl] : prev));
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const num = (k: string) => {
      const v = Number(fd.get(k));
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    const targetDimensionsMm = {
      width: num("width") ? toMm(num("width")!, units) : undefined,
      depth: num("depth") ? toMm(num("depth")!, units) : undefined,
      height: num("height") ? toMm(num("height")!, units) : undefined,
    };
    const hasDims = Object.values(targetDimensionsMm).some(Boolean);

    const payload = {
      description: (fd.get("description") as string) || undefined,
      targetDimensionsMm: hasDims ? targetDimensionsMm : undefined,
      units,
      skillLevel: fd.get("skillLevel"),
      budget: fd.get("budget"),
      style: fd.get("style"),
      currency: "USD",
      useMyToolsOnly,
      toolsOwned: useMyToolsOnly
        ? String(fd.get("toolsOwned") ?? "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    };

    // Hand the request to the draft page — it owns the streamed generation
    // so the plan can appear the moment the first draft is ready instead of
    // after the full carpenter review. sessionStorage survives the navigation.
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ payload, images })
    );
    sessionStorage.removeItem(DRAFT_KEY);
    setBusy(true);
    router.push("/plan/draft");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* photos */}
      <div className="space-y-2">
        <Label>Photos of what you want to build</Label>
        <div className="flex flex-wrap gap-3">
          {images.map((d, i) => (
            <div key={i} className="relative h-20 w-20 overflow-hidden rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d} alt={`Reference ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => setImages((p) => p.filter((_, k) => k !== i))}
                className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {images.length < 4 && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-muted"
            >
              <ImagePlus className="h-5 w-5" />
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          hidden
          onChange={(e) => onPickImages(e.target.files)}
        />
        <p className="text-xs text-muted-foreground">
          Up to 4 photos. Compressed on your device before upload — nothing leaves the
          browser until you generate.
        </p>
      </div>

      {/* description */}
      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder="e.g. A bookcase like this, but simpler. Pine is fine."
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* dimensions */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Target size</Label>
          <button
            type="button"
            onClick={() => setUnits(units === "metric" ? "imperial" : "metric")}
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            Enter in {units === "metric" ? "inches" : "mm"}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(["width", "depth", "height"] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={k} className="text-xs capitalize text-muted-foreground">
                {k} ({units === "metric" ? "mm" : "in"})
              </Label>
              <Input id={k} name={k} type="number" inputMode="decimal" min={0} step="any" />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Dimensions make the plan dramatically more accurate — the AI doesn&apos;t
          have to guess scale from a photo.
        </p>
      </div>

      {/* selects */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="skillLevel">Skill level</Label>
          <Select name="skillLevel" defaultValue={defaults.skillLevel}>
            <SelectTrigger id="skillLevel"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="budget">Budget</Label>
          <Select name="budget" defaultValue="balanced">
            <SelectTrigger id="budget"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="budget">Budget</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="premium">Premium</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="style">Style</Label>
          <Select name="style" defaultValue="match_photo">
            <SelectTrigger id="style"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="match_photo">Match photo</SelectItem>
              <SelectItem value="rustic">Rustic</SelectItem>
              <SelectItem value="modern">Modern</SelectItem>
              <SelectItem value="scandinavian">Scandinavian</SelectItem>
              <SelectItem value="industrial">Industrial</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* tools */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useMyToolsOnly}
            onChange={(e) => setUseMyToolsOnly(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          Use only the tools I own
        </label>
        {useMyToolsOnly && (
          <textarea
            name="toolsOwned"
            rows={4}
            defaultValue={defaults.toolsOwned.join("\n")}
            placeholder={"drill/driver\ncircular saw\norbital sander"}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        {useMyToolsOnly && (
          <p className="text-xs text-muted-foreground">
            {defaults.toolsOwned.length
              ? "Prefilled from your tool inventory — edit for this plan only. Update the saved list in Settings."
              : "No saved tool inventory — list what you own, one per line (saved list lives in Settings)."}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={busy}>
        {busy ? "Starting…" : "Generate plan"}
      </Button>
    </form>
  );
}
