import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  appUrl,
  priceIdFor,
  stripe,
  type PaidTier,
} from "@/lib/billing";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Start a Stripe Checkout session.
 *   POST { plan: "starter" | "workshop" | "pro" }  → subscription
 *   POST { plan: "single" }                        → one-time, +1 plan credit
 * Returns { url } to redirect the browser to.
 */
export async function POST(request: NextRequest) {
  const s = stripe();
  if (!s || !isSupabaseConfigured())
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "sign_in", message: "Sign in to upgrade." },
      { status: 401 }
    );

  let plan: PaidTier | "single";
  try {
    const body = await request.json();
    plan = body?.plan;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!["starter", "workshop", "pro", "single"].includes(plan))
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });

  const priceId = priceIdFor(plan);
  if (!priceId)
    return NextResponse.json(
      { error: `Price for ${plan} not configured` },
      { status: 503 }
    );

  // reuse the stored customer or create one
  const service = createServiceClient();
  const { data: prof } = await service
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  let customerId = prof?.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await s.customers.create({
      email: user.email ?? undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await service
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id);
  }

  const base = appUrl();
  const session = await s.checkout.sessions.create({
    mode: plan === "single" ? "payment" : "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url:
      plan === "single"
        ? `${base}/settings?billing=credit`
        : `${base}/settings?billing=success`,
    cancel_url: `${base}/pricing`,
    metadata: { userId: user.id, plan },
    ...(plan !== "single"
      ? { subscription_data: { metadata: { userId: user.id, plan } } }
      : {}),
  });

  return NextResponse.json({ url: session.url });
}
