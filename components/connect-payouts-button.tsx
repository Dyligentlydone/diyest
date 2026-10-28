"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** POSTs to /api/connect/onboard and redirects into Stripe Express onboarding. */
export function ConnectPayoutsButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();

  async function go() {
    setLoading(true);
    setErr("");
    const res = await fetch("/api/connect/onboard", { method: "POST" });
    if (res.status === 401) {
      router.push("/login?next=/settings");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    setErr(data.error ?? "Could not start payout setup.");
    setLoading(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={loading}
        className={className}
      >
        {loading ? "Opening Stripe…" : children}
      </button>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </>
  );
}
