"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function InviteForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      className="mt-6 flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim();
        if (c) router.push(`/invite/${encodeURIComponent(c.toUpperCase())}`);
      }}
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="INVITE CODE"
        autoCapitalize="characters"
        maxLength={40}
        className="h-11 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-center font-mono text-base tracking-widest outline-none focus:border-primary"
      />
      <button
        type="submit"
        className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Redeem
      </button>
    </form>
  );
}
