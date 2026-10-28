"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

/** POSTs to /api/marketplace/checkout and redirects to Stripe Checkout. */
export function BuyPlanButton({
  projectId,
  slug,
  priceLabel,
}: {
  projectId: string;
  slug: string;
  priceLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function buy() {
    setBusy(true);
    try {
      const res = await fetch("/api/marketplace/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (res.status === 401) {
        router.push(`/login?next=/p/${slug}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.error === "already_owned") {
        if (data.clonedProjectId)
          router.push(`/projects/${data.clonedProjectId}`);
        else router.refresh();
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Button type="button" size="lg" onClick={buy} disabled={busy}>
      <ShoppingCart className="mr-1.5 h-4 w-4" />
      {busy ? "Redirecting…" : `Buy this plan — ${priceLabel}`}
    </Button>
  );
}
