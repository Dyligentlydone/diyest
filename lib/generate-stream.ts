"use client";

/**
 * Reads /api/generate's NDJSON stream: each line is a GenEvent
 * ("plan" → show it now, "final" → replace with the reviewed plan,
 * "error" → show the failure). Pre-stream failures still come back as a
 * plain JSON { ok:false } error response.
 */
import type { GenEvent, GenerateSuccess } from "@/lib/ai/generate";

/** Normalized client-side error shape for either stream or pre-stream failures. */
export interface StreamError {
  ok: false;
  kind: string;
  summary?: string;
  errors: string[];
  reason?: string;
}

export interface StreamHandlers {
  /** stage-1 fields as they stream in — title/summary/parts count */
  onMeta?: (ev: Extract<GenEvent, { type: "meta" }>) => void;
  /** blueprint-ready geometry (stage 1 done, stage 2 running) */
  onPartial?: (ev: Extract<GenEvent, { type: "partial" }>) => void;
  onPlan?: (ev: Extract<GenEvent, { type: "plan" }>) => void;
  onFinal?: (result: GenerateSuccess) => void;
  onError?: (result: StreamError) => void;
}

function toStreamError(e: {
  kind?: string;
  summary?: string;
  errors?: string[];
  reason?: string;
}): StreamError {
  return {
    ok: false,
    kind: e.kind ?? "invalid",
    summary: e.summary,
    errors: e.errors ?? (e.summary ? [e.summary] : ["Generation failed."]),
    reason: e.reason,
  };
}

export async function streamGenerate(
  body: FormData,
  handlers: StreamHandlers
): Promise<void> {
  const res = await fetch("/api/generate", { method: "POST", body });

  if (!res.ok || !res.headers.get("content-type")?.includes("ndjson")) {
    // non-streamed error path (bad payload, usage limit, …)
    let msg = "Generation failed. Try again.";
    let kind = "error";
    let reason: string | undefined;
    try {
      const data = await res.json();
      msg = data.errors?.[0] ?? data.summary ?? msg;
      kind = data.kind ?? kind;
      reason = data.reason;
    } catch {
      /* keep defaults */
    }
    handlers.onError?.(toStreamError({ kind, summary: msg, errors: [msg], reason }));
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: GenEvent;
      try {
        ev = JSON.parse(line) as GenEvent;
      } catch {
        continue;
      }
      if (ev.type === "meta") handlers.onMeta?.(ev);
      else if (ev.type === "partial") handlers.onPartial?.(ev);
      else if (ev.type === "plan") handlers.onPlan?.(ev);
      else if (ev.type === "final") handlers.onFinal?.(ev.result);
      else if (ev.type === "error")
        handlers.onError?.(
          toStreamError(
            ev.result.ok === false && "summary" in ev.result
              ? { kind: ev.result.kind, summary: ev.result.summary }
              : { kind: "invalid", errors: (ev.result as { errors?: string[] }).errors }
          )
        );
    }
  }
}
