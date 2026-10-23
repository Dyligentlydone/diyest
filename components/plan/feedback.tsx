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

/** Whole-plan accuracy thumbs — sits under the plan overview. */
export function PlanFeedback({ projectId }: { projectId?: string | null }) {
  const [done, setDone] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [wantComment, setWantComment] = useState(false);

  async function rate(rating: "up" | "down") {
    setDone(rating);
    try {
      await send({ projectId, rating });
      if (rating === "down") setWantComment(true);
      else toast.success("Thanks for the feedback");
    } catch (e) {
      toast.error((e as Error).message);
      setDone(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
      <span className="text-muted-foreground">Was this plan accurate?</span>
      <button
        type="button"
        aria-label="Plan was accurate"
        disabled={done != null}
        onClick={() => void rate("up")}
        className={`rounded-full border p-1.5 ${done === "up" ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
      >
        <ThumbsUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Plan had problems"
        disabled={done != null}
        onClick={() => void rate("down")}
        className={`rounded-full border p-1.5 ${done === "down" ? "border-destructive bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-muted"}`}
      >
        <ThumbsDown className="h-4 w-4" />
      </button>
      {done && <span className="text-xs text-muted-foreground">Recorded — thanks.</span>}
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
            placeholder="What was wrong? (optional)"
            className="h-8 flex-1 rounded-md border bg-transparent px-2 text-sm outline-none"
            maxLength={2000}
          />
          <button type="submit" className="rounded border px-3 text-xs">
            Send
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
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
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
