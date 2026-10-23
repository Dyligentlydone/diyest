"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PlanView } from "@/components/plan/plan-view";
import { createClient } from "@/lib/supabase/client";
import type { Plan } from "@/lib/plan/schema";
import type { Units } from "@/lib/types";

const DRAFT_KEY = "diyest_draft_plan";

const subscribeNoop = () => () => {};

// cache so useSyncExternalStore's getSnapshot stays referentially stable
let draftCache: Draft | null | undefined;
function readDraft(): Draft | null {
  if (draftCache === undefined) {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      draftCache = raw ? (JSON.parse(raw) as Draft) : null;
    } catch {
      draftCache = null;
    }
  }
  return draftCache;
}

interface Draft {
  plan: Plan;
  unverified: string[];
  warnings: string[];
  images: string[];
  input: Record<string, unknown>;
  promptVersion?: string;
  savedId: string | null;
}

export function DraftClient({ isAuthed, units }: { isAuthed: boolean; units: Units }) {
  const router = useRouter();
  // sessionStorage is a client-only store: subscribe-read pattern keeps the
  // SSR/hydration shell consistent ("Loading…"), then the draft streams in.
  const stored = useSyncExternalStore(subscribeNoop, readDraft, () => undefined);
  const [override, setOverride] = useState<Draft | null>();
  const draft = override !== undefined ? override : stored;
  const setDraft = (d: Draft | null) => setOverride(d);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (draft === undefined) {
    return <div className="mx-auto max-w-4xl px-4 py-24 text-muted-foreground">Loading…</div>;
  }
  if (!draft) {
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
      draft.images.forEach((d, i) => {
        const [head, b] = d.split(",");
        const mime = head.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
        const bin = atob(b);
        const bytes = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        body.append("images", new Blob([bytes], { type: mime }), `input-${i}.jpg`);
      });

      const res = await fetch("/api/generate", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.errors?.[0] ?? data.summary ?? "Regeneration failed");
        return;
      }
      const next: Draft = {
        ...draft,
        plan: data.plan,
        unverified: data.unverified ?? [],
        warnings: data.warnings ?? [],
        promptVersion: data.promptVersion,
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      setDraft(next);
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
          mode: "build",
          plan: draft.plan,
          input: draft.input,
          prompt_version: draft.promptVersion ?? "plan.v1.2",
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

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
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
        warnings={draft.warnings}
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
