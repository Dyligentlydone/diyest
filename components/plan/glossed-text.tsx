"use client";

import { useMemo, useState, type ReactNode } from "react";
import { GLOSSARY, GLOSSARY_TERMS } from "@/lib/glossary";

/** Build a matcher once — longest terms first, whole words only. */
const TERM_RE = new RegExp(
  `\\b(${GLOSSARY_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi"
);

/**
 * Renders text with glossary terms underlined. Tapping a term shows a small
 * inline definition — mobile-first, no hover needed.
 */
export function GlossedText({ text }: { text: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const parts = useMemo(() => {
    const out: { t: string; term?: string }[] = [];
    let last = 0;
    for (const m of text.matchAll(TERM_RE)) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      out.push({ t: m[0], term: m[0].toLowerCase() });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }, [text]);

  const def = open ? GLOSSARY[open] : null;
  const nodes: ReactNode[] = parts.map((p, i) =>
    p.term ? (
      <button
        key={i}
        type="button"
        onClick={() => setOpen(open === p.term ? null : p.term!)}
        className="underline decoration-dotted decoration-primary/60 underline-offset-2 hover:text-primary"
      >
        {p.t}
      </button>
    ) : (
      p.t
    )
  );

  return (
    <span>
      {nodes}
      {open && def && (
        <span className="mt-1 block rounded border-l-2 border-primary/60 bg-primary/5 px-2 py-1 text-xs not-italic">
          <strong className="capitalize">{open}</strong> — {def}
        </span>
      )}
    </span>
  );
}
