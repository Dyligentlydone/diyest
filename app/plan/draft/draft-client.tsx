"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PlanView } from "@/components/plan/plan-view";
import { createClient } from "@/lib/supabase/client";
import { streamGenerate } from "@/lib/generate-stream";
import type { Plan } from "@/lib/plan/schema";
import type { Units } from "@/lib/types";

const DRAFT_KEY = "diyest_draft_plan";
const PENDING_KEY = "diyest_pending_gen";

const subscribeNoop = () => () => {};

interface Draft {
  plan: Plan;
  unverified: string[];
  blockers: string[];
  warnings: string[];
  images: string[];
  input: Record<string, unknown>;
  promptVersion?: string;
  improved?: boolean;
  reviewPending?: boolean;
  /** true while stage 2/joints are still generating (blueprint-only view) */
  partial?: boolean;
  /** step numbers the review repair changed — highlighted on screen */
  changedSteps?: number[];
  savedId: string | null;
}

/** Steps the carpenter-review repair altered — title, text or parts changed. */
function diffSteps(before: Plan["steps"], after: Plan["steps"]): number[] {
  const byN = new Map(before.map((s) => [s.n, s]));
  return after
    .filter((s) => {
      const b = byN.get(s.n);
      return !b || b.title !== s.title || b.text !== s.text;
    })
    .map((s) => s.n);
}

interface PendingGen {
  payload: Record<string, unknown>;
  images: string[]; // data URLs
}

// caches keyed by raw storage string so useSyncExternalStore's getSnapshot
// stays referentially stable AND notices when /new writes a new request
let draftCache: { raw: string | null; parsed: Draft | null } | undefined;
function readDraft(): Draft | null {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!draftCache || draftCache.raw !== raw) {
    let parsed: Draft | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as Draft) : null;
    } catch {
      parsed = null;
    }
    draftCache = { raw, parsed };
  }
  return draftCache.parsed;
}

let pendingCache: { raw: string | null; parsed: PendingGen | null } | undefined;
function readPending(): PendingGen | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!pendingCache || pendingCache.raw !== raw) {
    let parsed: PendingGen | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as PendingGen) : null;
    } catch {
      parsed = null;
    }
    pendingCache = { raw, parsed };
  }
  return pendingCache.parsed;
}

function dataUrlToBlob(d: string): Blob {
  const [head, body] = d.split(",");
  const mime = head.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function persistDraft(d: Draft) {
  const raw = JSON.stringify(d);
  draftCache = { raw, parsed: d };
  sessionStorage.setItem(DRAFT_KEY, raw);
}

export function DraftClient({
  isAuthed,
  units,
  kerfMm = 3,
}: {
  isAuthed: boolean;
  units: Units;
  kerfMm?: number;
}) {
  const router = useRouter();
  // sessionStorage is a client-only store: subscribe-read pattern keeps the
  // SSR/hydration shell consistent ("Loading…"), then the draft streams in.
  const stored = useSyncExternalStore(subscribeNoop, readDraft, () => undefined);
  const pending = useSyncExternalStore(subscribeNoop, readPending, () => undefined);
  const [override, setOverride] = useState<Draft | null>();
  const draft = override !== undefined ? override : stored;
  const setDraft = (d: Draft | null) => {
    if (d) persistDraft(d);
    setOverride(d);
  };
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [genFinished, setGenFinished] = useState(false); // stream ended (or never ran)
  // live pipeline phase — non-null while a generation is running. The plan is
  // NEVER shown mid-run: drafts and partials stay hidden until the final,
  // carpenter-checked plan arrives (or the connection drops).
  const [phase, setPhase] = useState<null | "reading" | "geometry" | "joinery" | "checking">(null);
  const [elapsed, setElapsed] = useState(0);
  const [genError, setGenError] = useState<{ msg: string; kind?: string } | null>(null);
  const [meta, setMeta] = useState<{ title?: string; summary?: string; partsReceived?: number }>({});
  const startedRef = useRef(false);
  // "generating" = a pending request exists and the stream hasn't finished
  const generating = !!pending && !genFinished;

  // elapsed-time ticker for the progress screen
  useEffect(() => {
    if (!phase) return;
    const t0 = Date.now() - elapsed * 1000;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // If the /new form handed us a pending request, run the streamed generation.
  useEffect(() => {
    if (startedRef.current || !pending) return;
    startedRef.current = true;

    const body = new FormData();
    body.set("payload", JSON.stringify(pending.payload));
    pending.images.forEach((d, i) => body.append("images", dataUrlToBlob(d), `input-${i}.jpg`));

    setPhase("reading");
    void streamGenerate(body, {
      onMeta: (ev) => {
        setMeta((m) => ({ ...m, ...ev }));
        if (ev.partsReceived != null && ev.partsReceived > 0)
          setPhase((p) => (p === "reading" ? "geometry" : p));
      },
      onPartial: () => {
        // geometry done — joints/steps are being written. Not shown: only the
        // final checked plan ever reaches the screen.
        setPhase("joinery");
      },
      onPlan: (ev) => {
        // full plan drafted — persist it as a recovery point (so a dropped
        // connection or reload doesn't lose everything) but keep holding the
        // progress screen while the carpenter review/repair runs.
        sessionStorage.removeItem(PENDING_KEY);
        persistDraft({
          plan: ev.plan,
          unverified: ev.unverified,
          blockers: [],
          warnings: ev.warnings,
          images: pending.images,
          input: pending.payload,
          promptVersion: ev.promptVersion,
          reviewPending: true,
          savedId: null,
        });
        setPhase("checking");
      },
      onFinal: (r) => {
        setDraft({
          plan: r.plan,
          unverified: r.unverified,
          blockers: r.blockers,
          warnings: r.warnings,
          images: pending.images,
          input: pending.payload,
          promptVersion: r.promptVersion,
          improved: r.improved,
          reviewPending: r.reviewPending,
          savedId: null,
        });
        setPhase(null);
        setGenFinished(true);
      },
      onError: (e) => {
        setGenError({
          msg:
            e.kind === "not_buildable"
              ? e.summary ?? "That doesn't look like a buildable project."
              : e.errors[0] ?? "Generation failed. Try again.",
          kind: e.reason === "anonymous_limit" || e.reason === "free_limit" ? "limit" : e.kind,
        });
        setPhase(null);
        setGenFinished(true);
      },
      onEnd: (status) => {
        setGenFinished(true);
        if (status !== "closed") return;
        // stream dropped before the final event — fall back to the best plan
        // received so far (honestly marked check-pending), or a clear error
        setPhase(null);
        const d = readDraft();
        if (d) setDraft({ ...d, partial: false, reviewPending: true });
        else
          setGenError({
            msg: "The connection dropped before your plan finished. Please try again.",
          });
      },
    });
  }, [pending]);

  if (draft === undefined) {
    return <div className="mx-auto max-w-4xl px-4 py-24 text-muted-foreground">Loading…</div>;
  }

  // ---- live progress screen: shown for the WHOLE pipeline. No blueprint is
  // ever rendered until the final, carpenter-checked plan arrives. ----
  if (phase) {
    const stages = [
      { key: "reading", label: "Reading your photo" },
      { key: "geometry", label: "Measuring parts & drawing geometry" },
      { key: "joinery", label: "Choosing joints & writing build steps" },
      { key: "checking", label: "Master carpenter check & fixes" },
    ] as const;
    const current = stages.findIndex((s) => s.key === phase);
    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, "0");
    return (
      <main className="mx-auto max-w-2xl px-4 py-24">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <h1 className="mt-6 text-xl font-semibold">
            {meta.title ?? "Drawing up your plan…"}
          </h1>
          {meta.summary && (
            <p className="mt-2 text-muted-foreground">{meta.summary}</p>
          )}
        </div>
        <ol className="mx-auto mt-10 max-w-md space-y-3">
          {stages.map((s, i) => (
            <li key={s.key} className="flex items-center gap-3 text-sm">
              {i < current ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">✓</span>
              ) : i === current ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
              ) : (
                <span className="h-5 w-5 rounded-full border border-muted" />
              )}
              <span className={i < current ? "text-muted-foreground line-through" : i === current ? "font-medium" : "text-muted-foreground"}>
                {s.label}
                {s.key === "geometry" && i === current && meta.partsReceived != null
                  ? ` — ${meta.partsReceived} parts so far`
                  : ""}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-center text-sm text-muted-foreground">
          {mm}:{ss} elapsed — a fully checked plan usually takes 2–10 minutes.
          We only show blueprints that passed the master carpenter check.
        </p>
      </main>
    );
  }

  if (genError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">
          {genError.kind === "not_buildable" ? "Not a buildable project" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-muted-foreground">{genError.msg}</p>
        <Link href="/new" className="mt-4 inline-block underline underline-offset-4">
          Try a different project
        </Link>
      </main>
    );
  }

  if (!draft) {
    if (generating) {
      return (
        <main className="mx-auto max-w-2xl px-4 py-24 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <h1 className="mt-6 text-xl font-semibold">
            {meta.title ?? "Drawing up your plan…"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {meta.summary ??
              "Reading the photo, laying out parts and joinery, writing the steps."}
          </p>
          {meta.partsReceived != null && (
            <p className="mt-4 text-sm text-muted-foreground">
              Laying out parts… {meta.partsReceived} so far
            </p>
          )}
        </main>
      );
    }
    return (
      <main className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">No draft plan</h1>
        <p className="mt-2 text-muted-foreground">
          Your generated plan lives in this browser tab&apos;s session.
        </p>
        <Link href="/new" className="mt-4 inline-block underline underline-offset-4">
          Start a new project
        </Link>
      </main>
    );
  }

  const questions = draft.plan.clarifying_questions ?? [];

  async function regenerate() {
    if (!draft) return;
    setBusy(true);
    setElapsed(0);
    setPhase("reading");
    try {
      const body = new FormData();
      body.set(
        "payload",
        JSON.stringify({
          ...draft.input,
          clarificationAnswers: questions
            .map((q) => ({ question: q, answer: answers[q] ?? "" }))
            .filter((qa) => qa.answer.trim()),
        })
      );
      draft.images.forEach((d, i) =>
        body.append("images", dataUrlToBlob(d), `input-${i}.jpg`)
      );

      // same contract as the initial run: hold the progress screen, only the
      // final checked plan is ever shown
      await streamGenerate(body, {
        onMeta: (ev) => {
          setMeta((m) => ({ ...m, ...ev }));
          if (ev.partsReceived != null && ev.partsReceived > 0)
            setPhase((p) => (p === "reading" ? "geometry" : p));
        },
        onPartial: () => setPhase("joinery"),
        onPlan: () => setPhase("checking"),
        onFinal: (r) => {
          setDraft({
            ...draft!,
            plan: r.plan,
            unverified: r.unverified,
            blockers: r.blockers,
            warnings: r.warnings,
            promptVersion: r.promptVersion,
            improved: r.improved,
            reviewPending: r.reviewPending,
            changedSteps: diffSteps(draft!.plan.steps ?? [], r.plan.steps),
            partial: false,
          });
          setPhase(null);
        },
        onError: (e) => {
          toast.error(e.errors[0] ?? e.summary ?? "Regeneration failed");
          setPhase(null);
        },
        onEnd: (status) => {
          setPhase(null);
          if (status === "closed")
            toast.error("Connection dropped — keeping your previous plan.");
        },
      });
      setAnswers({});
      window.scrollTo(0, 0);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    if (!isAuthed) {
      router.push("/login?next=/plan/draft");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login?next=/plan/draft");
        return;
      }

      const projectId = crypto.randomUUID();
      const imagePaths: string[] = [];
      for (const [i, d] of draft.images.entries()) {
        const [head, b] = d.split(",");
        const mime = head.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
        const ext = mime.includes("png") ? "png" : "jpg";
        const path = `${user.id}/${projectId}/input-${i}.${ext}`;
        const bin = atob(b);
        const bytes = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        const { error } = await supabase.storage
          .from("project-images")
          .upload(path, new Blob([bytes], { type: mime }), { upsert: true });
        if (!error) imagePaths.push(path);
        else console.warn("image upload failed", error.message);
      }

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: projectId,
          title: draft.plan.title,
          mode:
            typeof draft.input?.mode === "string"
              ? draft.input.mode
              : "build",
          plan: draft.plan,
          input: draft.input,
          prompt_version: draft.promptVersion ?? "plan.v1.8",
          imagePaths,
        }),
      });
      const out = await res.json();
      if (!res.ok) {
        toast.error(out.error ?? "Could not save project");
        return;
      }
      sessionStorage.removeItem(DRAFT_KEY);
      router.push(`/projects/${projectId}`);
    } finally {
      setBusy(false);
    }
  }

  // the progress screen above guarantees only final checked plans render here
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      {draft.improved && (
        <div className="mb-6 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <strong>Improved after carpenter review.</strong> The plan below was adjusted
          automatically where our checks found problems — remaining flags are listed
          under Unverified.
        </div>
      )}

      {questions.length > 0 && (
        <Card className="mb-6 border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">
              diyest has {questions.length} question{questions.length > 1 ? "s" : ""} for you
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {questions.map((q) => (
              <div key={q} className="space-y-1.5">
                <Label className="text-sm font-normal">{q}</Label>
                <input
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={answers[q] ?? ""}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [q]: e.target.value }))
                  }
                  placeholder="Your answer (optional)"
                />
              </div>
            ))}
            <div className="flex gap-3">
              <Button
                onClick={regenerate}
                disabled={busy || !Object.values(answers).some((a) => a.trim())}
              >
                {busy ? "Regenerating…" : "Regenerate with answers"}
              </Button>
              <p className="self-center text-xs text-muted-foreground">
                Or continue with the plan below — it&apos;s already complete.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <PlanView
        plan={draft.plan}
        units={units}
        unverified={draft.unverified}
        blockers={draft.blockers}
        warnings={draft.warnings}
        reviewPending={draft.reviewPending}
        checking={false}
        changedSteps={draft.changedSteps ?? []}
        kerfMm={kerfMm}
        projectId={draft.savedId}
        excludeMaterials={
          Array.isArray(draft.input?.materialsOwned)
            ? (draft.input.materialsOwned as string[])
            : []
        }
      />

      <div className="sticky bottom-4 mt-8 flex justify-center">
        <div className="flex items-center gap-3 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
          {!isAuthed && (
            <span className="text-xs text-muted-foreground">
              Anonymous draft — sign up to keep it
            </span>
          )}
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : isAuthed ? "Save to my projects" : "Sign up to save"}
          </Button>
        </div>
      </div>
    </main>
  );
}
