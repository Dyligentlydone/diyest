"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  LifeBuoy,
  Send,
  ShieldAlert,
  ThumbsDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { compressImage } from "@/lib/images";
import type { Plan } from "@/lib/plan/schema";

interface Msg {
  role: "user" | "assistant";
  content: string;
  safety?: boolean;
  /** index into msgs of the question this reply answered */
}

export function StuckChat({
  plan,
  step,
  projectId,
}: {
  plan: Plan;
  /** step context — in build mode this is the current step */
  step?: { n: number; title: string; text: string } | null;
  projectId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // index of the last assistant reply — "didn't help" re-asks that question on Sol
  const lastReplyIdx = msgs.map((m, i) => (m.role === "assistant" ? i : -1))
    .filter((i) => i >= 0)
    .pop();

  async function pickPhoto(files: FileList | null) {
    if (!files?.length) return;
    try {
      setPhoto(await compressImage(files[0]));
    } catch (e) {
      toast.error((e as Error).message);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send(text: string, escalate = false) {
    if (!text.trim() && !photo) return;
    const image = photo ?? undefined;
    const userMsg: Msg = { role: "user", content: text || "(photo)" };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    setPhoto(null);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan,
          step: step ?? undefined,
          history: msgs.slice(-8),
          question: text || "Here's my progress — am I on track?",
          image,
          escalate,
          projectId: projectId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "No answer came back");
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply.reply,
          safety: !!data.reply.safety_related,
        },
      ]);
      if (data.reply.needs_extra_tools)
        toast.info("This may need a tool not in your plan — check the reply.");
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: `Something went wrong: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  /** "didn't help" → resend the last user question on Sol */
  function flagWrong() {
    const lastQ = [...msgs]
      .slice(0, lastReplyIdx)
      .reverse()
      .find((m) => m.role === "user");
    if (!lastQ) return;
    void send(`(checking again) ${lastQ.content}`, true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-blueprint px-4 py-2.5 text-sm font-medium text-blueprint-foreground shadow-lg hover:bg-blueprint/90"
      >
        <LifeBuoy className="h-4 w-4" /> I&apos;m stuck
      </button>

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-2xl border bg-background shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:rounded-2xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-medium">
              Build help
              {step && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  step {step.n}: {step.title}
                </span>
              )}
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="rounded-full p-1 hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {msgs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Stuck on a step, or want your progress checked? Ask — or snap a
                photo of where you are.
              </p>
            )}
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-blueprint text-blueprint-foreground"
                    : "bg-muted"
                }`}
              >
                {m.safety && (
                  <Badge variant="destructive" className="mb-1 gap-1 text-[10px]">
                    <ShieldAlert className="h-3 w-3" /> safety
                  </Badge>
                )}
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.role === "assistant" && i === lastReplyIdx && !busy && (
                  <button
                    type="button"
                    onClick={flagWrong}
                    className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ThumbsDown className="h-3 w-3" /> Didn&apos;t help — check
                    with senior carpenter
                  </button>
                )}
              </div>
            ))}
            {busy && (
              <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                Thinking…
              </div>
            )}
          </div>

          <div className="border-t px-3 py-3">
            {photo && (
              <div className="mb-2 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="Progress" className="h-12 w-12 rounded object-cover" />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="text-xs text-muted-foreground underline"
                >
                  remove
                </button>
              </div>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <button
                type="button"
                aria-label="Attach progress photo"
                onClick={() => fileRef.current?.click()}
                className="rounded-full p-2 text-muted-foreground hover:bg-muted"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                hidden
                onChange={(e) => pickPhoto(e.target.files)}
              />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything about the build…"
                className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                maxLength={2000}
              />
              <Button type="submit" size="sm" disabled={busy || (!input.trim() && !photo)}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
