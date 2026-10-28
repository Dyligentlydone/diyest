"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Flag, ThumbsDown, ThumbsUp } from "lucide-react";

async function send(payload: Record<string, unknown>) {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Couldn't send feedback");
}

/** Whole-plan accuracy thumbs — prominent beta feedback under the overview. */
export function PlanFeedback({ projectId }: { projectId?: string | null }) {
  const [done, setDone] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [wantComment, setWantComment] = useState(false);

  async function rate(rating: "up" | "down") {
    setDone(rating);
    try {
      await send({ projectId, rating });
      if (rating === "down") setWantComment(true);
      else toast.success("Thanks — that trains the planner");
    } catch (e) {
      toast.error((e as Error).message);
      setDone(null);
    }
  }

  return (
    <div className="rounded-lg border-2 border-blueprint/20 bg-blueprint/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm font-semibold">Beta check — is this plan buildable?</p>
          <p className="text-xs text-muted-foreground">
            Your rating goes straight into the plan-review data.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={done != null}
            onClick={() => void rate("up")}
            className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              done === "up"
                ? "border-green-600 bg-green-600/10 text-green-700"
                : "hover:bg-muted disabled:opacity-60"
            }`}
          >
            <ThumbsUp className="h-4 w-4" /> Yes
          </button>
          <button
            type="button"
            disabled={done != null}
            onClick={() => void rate("down")}
            className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              done === "down"
                ? "border-destructive bg-destructive/10 text-destructive"
                : "hover:bg-muted disabled:opacity-60"
            }`}
          >
            <ThumbsDown className="h-4 w-4" /> Problems
          </button>
        </div>
      </div>
      {done && !wantComment && (
        <p className="mt-2 text-xs text-muted-foreground">Recorded — thanks.</p>
      )}
      {wantComment && (
        <form
          className="flex w-full gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await send({ projectId, rating: "down", comment });
              toast.success("Report sent — it feeds our plan fixes");
              setWantComment(false);
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What was wrong? Wrong joint, bad dimensions, missing tool…"
            autoFocus
            className="h-9 flex-1 rounded-md border bg-background px-3 text-sm outline-none"
            maxLength={2000}
          />
          <button type="submit" className="h-9 rounded-md bg-blueprint px-4 text-sm font-medium text-blueprint-foreground">
            Send report
          </button>
        </form>
      )}
    </div>
  );
}

/** "Report a problem" per step — compact flag + optional note. */
export function StepFeedback({
  projectId,
  stepN,
}: {
  projectId?: string | null;
  stepN: number;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);

  if (sent)
    return <span className="text-[11px] text-muted-foreground">Reported</span>;

  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
      >
        <Flag className="h-3 w-3" /> Report a problem
      </button>
      {open && (
        <form
          className="mt-1 flex gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await send({
                projectId,
                stepN,
                rating: "down",
                comment,
              });
              setSent(true);
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What's wrong with this step?"
            autoFocus
            className="h-7 w-56 rounded border bg-transparent px-2 text-xs outline-none"
            maxLength={2000}
          />
          <button type="submit" className="rounded border px-2 text-xs">
            Send
          </button>
        </form>
      )}
    </span>
  );
}
