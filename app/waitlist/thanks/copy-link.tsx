"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex gap-2">
      <input
        readOnly
        value={link}
        onFocus={(e) => e.target.select()}
        className="h-9 min-w-0 flex-1 rounded-md border bg-muted/40 px-3 font-mono text-xs outline-none"
      />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs hover:bg-muted"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
