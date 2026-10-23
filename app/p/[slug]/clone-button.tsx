"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CloneButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function clone() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/clone`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't clone");
      router.push(`/projects/${data.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Button type="button" onClick={clone} disabled={busy}>
      <Copy className="mr-1.5 h-4 w-4" />
      {busy ? "Copying…" : "Build this yourself"}
    </Button>
  );
}
