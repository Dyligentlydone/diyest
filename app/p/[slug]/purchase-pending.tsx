"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown right after Stripe redirects back with ?bought=1 while the webhook
 * is still landing. Polls a server refresh until the purchase row appears.
 */
export function PurchasePending() {
  const router = useRouter();
  const tries = useRef(0);

  useEffect(() => {
    const t = setInterval(() => {
      tries.current += 1;
      router.refresh();
      if (tries.current > 12) clearInterval(t);
    }, 2500);
    return () => clearInterval(t);
  }, [router]);

  return (
    <p className="mt-4 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
      Payment received — your copy is being prepared. This page updates
      automatically in a few seconds…
    </p>
  );
}
