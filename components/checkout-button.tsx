"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** POSTs to /api/billing/checkout (or /portal) and redirects to Stripe. */
export function CheckoutButton({
  plan,
  children,
  className,
}: {
  plan: "starter" | "workshop" | "pro" | "single";
  children: React.ReactNode;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();

  async function go() {
    setLoading(true);
    setErr("");
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    if (res.status === 401) {
      router.push("/login?next=/pricing");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    setErr(data.error ?? "Checkout failed — try again.");
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
        {loading ? "Redirecting…" : children}
      </button>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </>
  );
}

/** Opens the Stripe customer portal for the signed-in user. */
export function PortalButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setLoading(true);
    setErr("");
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    setErr(data.error ?? "Could not open billing portal.");
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
        {loading ? "Opening…" : children}
      </button>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </>
  );
}
