"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Stethoscope, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ALL_TOOLS, canonicalTool } from "@/lib/tools";
import { ToolChecklist, toolsFromFormData } from "@/components/tool-checklist";
import type { Diagnosis, Ideas } from "@/lib/ai/prompts/m4";

const CANON_SET = new Set(ALL_TOOLS.map((t) => t.toLowerCase()));
const canonicalToolsOf = (tools: string[]) =>
  tools.filter((t) => CANON_SET.has(t.toLowerCase()));
const customToolsOf = (tools: string[]) =>
  tools
    .filter((t) => !CANON_SET.has(t.toLowerCase()))
    .map((t) => canonicalTool(t) ?? t)
    .join("\n");

const DRAFT_KEY = "diyest_draft_plan";
const PENDING_KEY = "diyest_pending_gen";

export type EntryMode = "build" | "fix" | "space" | "leftovers" | "describe";

export const MODE_COPY: Record<EntryMode, { title: string; desc: string; submit: string }> = {
  build: {
    title: "Build this",
    desc: "Upload a photo or describe the piece. diyest works out the parts, joinery, shopping list and steps.",
    submit: "Generate plan",
  },
  describe: {
    title: "Describe it",
    desc: "No photo needed — just say what you want to make.",
    submit: "Generate plan",
  },
  fix: {
    title: "Fix it",
    desc: "Photo of something broken — we diagnose it, then build a repair plan.",
    submit: "Diagnose it",
  },
  space: {
    title: "My space",
    desc: "Photo of an empty corner or wall plus rough measurements — we'll suggest projects that fit.",
    submit: "Suggest projects",
  },
  leftovers: {
    title: "Leftovers",
    desc: "List the materials you have (a photo helps too) — we'll suggest projects that use them up.",
    submit: "Suggest projects",
  },
};

export function BuildForm({
  defaults,
  mode,
}: {
  defaults: { units: Units; skillLevel: SkillLevel; toolsOwned: string[] };
  mode: EntryMode;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>([]); // compressed data URLs
  const [units, setUnits] = useState<Units>(defaults.units);
  const [useMyToolsOnly, setUseMyToolsOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // fix mode: diagnosis result; space/leftovers: idea results + pick
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [ideas, setIdeas] = useState<Ideas["ideas"] | null>(null);
  const [pickedIdea, setPickedIdea] = useState<number | null>(null);

  const needsPhoto = mode === "fix" || mode === "space";
  const copy = MODE_COPY[mode];

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

  const num = (fd: FormData, k: string) => {
    const v = Number(fd.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };

  function startGeneration(payload: Record<string, unknown>) {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ payload, images }));
    sessionStorage.removeItem(DRAFT_KEY);
    setBusy(true);
    router.push("/plan/draft");
  }

  function basePayload(fd: FormData) {
    const targetDimensionsMm = {
      width: num(fd, "width") ? toMm(num(fd, "width")!, units) : undefined,
      depth: num(fd, "depth") ? toMm(num(fd, "depth")!, units) : undefined,
      height: num(fd, "height") ? toMm(num(fd, "height")!, units) : undefined,
    };
    return {
      description: (fd.get("description") as string) || undefined,
      targetDimensionsMm: Object.values(targetDimensionsMm).some(Boolean)
        ? targetDimensionsMm
        : undefined,
      units,
      skillLevel: fd.get("skillLevel"),
      budget: fd.get("budget"),
      style: fd.get("style"),
      currency: "USD",
      useMyToolsOnly,
      toolsOwned: useMyToolsOnly ? toolsFromFormData(fd) : undefined,
    };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = basePayload(fd);

    if (mode === "build" || mode === "describe") {
      if (mode === "build" && !images.length && !payload.description)
        return setError("Add a photo or a description.");
      if (mode === "describe" && !payload.description)
        return setError("Describe what you want to make.");
      startGeneration({ ...payload, mode });
      return;
    }

    if (mode === "fix") {
      if (!images.length) return setError("Add a photo of the problem.");
      if (!diagnosis) {
        setBusy(true);
        try {
          const res = await fetch("/api/diagnose", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              description: payload.description,
              units,
              images,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error ?? "Diagnosis failed");
          setDiagnosis(data.diagnosis as Diagnosis);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
        return;
      }
      // diagnosis accepted → generate the repair plan
      startGeneration({
        ...payload,
        mode: "fix",
        diagnosis: `${diagnosis.likely_cause}. ${diagnosis.repair_summary}`,
      });
      return;
    }

    // space / leftovers → ideas first
    if (!ideas) {
      if (mode === "space" && !payload.targetDimensionsMm && !payload.description)
        return setError("Measure the space (even roughly) or describe it.");
      if (mode === "leftovers") {
        const mats = String(fd.get("materials") ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!mats.length) return setError("List the materials you have.");
      }
      setBusy(true);
      try {
        const materialsOwned = String(fd.get("materials") ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const res = await fetch("/api/ideas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: mode as "space" | "leftovers",
            description: payload.description,
            spaceMm: mode === "space" ? payload.targetDimensionsMm : undefined,
            materialsOwned: mode === "leftovers" ? materialsOwned : undefined,
            skillLevel: payload.skillLevel,
            units,
            images,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? "No ideas came back");
        setIdeas(data.ideas as Ideas["ideas"]);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (pickedIdea == null) return setError("Pick a project idea first.");
    const idea = ideas[pickedIdea];
    const materialsOwned = String(fd.get("materials") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    startGeneration({
      ...payload,
      mode,
      chosenIdea: `${idea.title} — ${idea.summary}`,
      spaceConstraintsMm: mode === "space" ? payload.targetDimensionsMm : undefined,
      materialsOwned: mode === "leftovers" ? materialsOwned : undefined,
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* photos — required for fix/space, optional elsewhere, hidden for describe */}
      {mode !== "describe" && (
        <div className="space-y-2">
          <Label>
            {mode === "fix"
              ? "Photos of the problem"
              : mode === "space"
                ? "Photos of the space"
                : "Photos of what you want to build"}
          </Label>
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
            {needsPhoto ? "At least one photo needed. " : "Up to 4 photos. "}
            Compressed on your device before upload — nothing leaves the browser
            until you continue.
          </p>
        </div>
      )}

      {/* leftovers: materials list */}
      {mode === "leftovers" && (
        <div className="space-y-1.5">
          <Label htmlFor="materials">Materials you have</Label>
          <textarea
            id="materials"
            name="materials"
            rows={3}
            placeholder={"3 pallets\nhalf a sheet of 18mm plywood\na box of 2x4 offcuts"}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            One per line — these are excluded from the shopping list.
          </p>
        </div>
      )}

      {/* description */}
      <div className="space-y-1.5">
        <Label htmlFor="description">
          {mode === "describe"
            ? "What do you want to make?"
            : mode === "fix"
              ? "What's wrong with it?"
              : "Notes (optional)"}
        </Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder={
            mode === "describe"
              ? "e.g. A bench for my entryway with shoe storage underneath"
              : mode === "fix"
                ? "e.g. The drawer front came off and the runner is bent"
                : mode === "space"
                  ? "e.g. Under the stairs — want hidden storage"
                  : "e.g. A bookcase like this, but simpler. Pine is fine."
          }
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* dimensions — build/describe = target size; space = available space */}
      {mode !== "fix" && mode !== "leftovers" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{mode === "space" ? "Space available" : "Target size"}</Label>
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
            {mode === "space"
              ? "Rough measurements are fine — projects are suggested to fit inside."
              : "Dimensions make the plan dramatically more accurate — the AI doesn't have to guess scale from a photo."}
          </p>
        </div>
      )}

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
          <>
            <ToolChecklist
              defaultChecked={canonicalToolsOf(defaults.toolsOwned)}
              defaultCustom={customToolsOf(defaults.toolsOwned)}
            />
            <p className="text-xs text-muted-foreground">
              {defaults.toolsOwned.length
                ? "Prefilled from your tool inventory — edit for this plan only. Update the saved list in Settings."
                : "Check the tools you own (saved list lives in Settings)."}
            </p>
          </>
        )}
      </div>

      {/* fix mode: diagnosis result */}
      {mode === "fix" && diagnosis && (
        <div className="space-y-3 rounded-md border p-4">
          <p className="flex items-center gap-2 font-medium">
            <Stethoscope className="h-4 w-4" /> Diagnosis
          </p>
          <div className="text-sm">
            <p className="font-medium">{diagnosis.likely_cause}</p>
            <p className="mt-1 text-muted-foreground">{diagnosis.repair_summary}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Confidence: {Math.round(diagnosis.confidence * 100)}%
            </p>
          </div>
          {diagnosis.checks.length > 0 && (
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {diagnosis.checks.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          {diagnosis.call_a_pro ? (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <strong>Call a professional.</strong>{" "}
              {diagnosis.pro_reason ??
                "This repair involves licensed-trade work — we won't build a DIY plan for it."}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Looks DIY-fixable — continue to build the repair plan.
            </p>
          )}
        </div>
      )}

      {/* space/leftovers: idea picker */}
      {(mode === "space" || mode === "leftovers") && ideas && (
        <div className="space-y-2">
          <Label>Pick a project</Label>
          <div className="space-y-2">
            {ideas.map((idea, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPickedIdea(i)}
                className={`w-full rounded-md border p-3 text-left text-sm transition-colors ${
                  pickedIdea === i
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {idea.title}
                  <Badge variant="secondary" className="shrink-0 capitalize">
                    {idea.difficulty}
                  </Badge>
                </span>
                <span className="mt-1 block text-muted-foreground">{idea.summary}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {idea.why_it_fits} · ~${idea.est_cost.low}–${idea.est_cost.high}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={busy || (mode === "fix" && !!diagnosis?.call_a_pro)}
      >
        {busy
          ? "Working…"
          : mode === "fix" && diagnosis
            ? "Make repair plan"
            : (mode === "space" || mode === "leftovers") && ideas
              ? "Plan this project"
              : copy.submit}
      </Button>
      {(mode === "space" || mode === "leftovers") && ideas && (
        <button
          type="button"
          onClick={() => {
            setIdeas(null);
            setPickedIdea(null);
          }}
          className="w-full text-center text-xs text-muted-foreground underline"
        >
          Start over with different suggestions
        </button>
      )}
      {mode === "fix" && diagnosis && !diagnosis.call_a_pro && (
        <button
          type="button"
          onClick={() => setDiagnosis(null)}
          className="w-full text-center text-xs text-muted-foreground underline"
        >
          Not right — diagnose again
        </button>
      )}
    </form>
  );
}
