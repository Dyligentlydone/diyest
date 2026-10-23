"use client";

import { useState } from "react";
import { toast } from "sonner";

const STATUSES = [
  { key: "planned", label: "Planned" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
] as const;

export function StatusSelect({
  projectId,
  status,
}: {
  projectId: string;
  status: string;
}) {
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);

  async function onChange(next: string) {
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Couldn't update status");
    } catch (e) {
      toast.error((e as Error).message);
      setValue(status);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={value}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void onChange(e.target.value)}
      className="rounded border bg-transparent px-1.5 py-0.5 text-xs capitalize"
      aria-label="Project status"
    >
      {STATUSES.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
