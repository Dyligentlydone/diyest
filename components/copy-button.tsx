"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className ?? "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — the text stays visible to copy by hand */
        }
      }}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}
