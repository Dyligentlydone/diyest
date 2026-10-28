import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { appUrl, stripe } from "@/lib/billing";
import { feeCents } from "@/lib/connect";

/**
 * POST { projectId } — Stripe Checkout for a paid gallery plan.
 * Destination charge: buyer pays the platform, Stripe routes the sale minus
 * the 10% application fee to the creator's Connect account.
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
      { error: "sign_in", message: "Sign in to buy this plan." },
      { status: 401 }
    );

  let projectId: string;
  try {
    projectId = (await request.json())?.projectId;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!projectId)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, title, slug, is_public, price_cents, user_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project?.is_public || !project.price_cents)
    return NextResponse.json({ error: "Plan not for sale" }, { status: 404 });
  if (project.user_id === user.id)
    return NextResponse.json({ error: "You own this plan" }, { status: 409 });

  const { data: seller } = await service
    .from("profiles")
    .select("stripe_account_id, stripe_account_enabled")
    .eq("id", project.user_id)
    .maybeSingle();
  if (!seller?.stripe_account_id || !seller.stripe_account_enabled)
    return NextResponse.json(
      { error: "Seller payouts aren't set up yet" },
      { status: 409 }
    );

  const { data: existing } = await service
    .from("plan_purchases")
    .select("id, cloned_project_id")
    .eq("buyer_id", user.id)
    .eq("project_id", projectId)
    .is("refunded_at", null)
    .maybeSingle();
  if (existing)
    return NextResponse.json(
      { error: "already_owned", clonedProjectId: existing.cloned_project_id },
      { status: 409 }
    );

  const base = appUrl();
  const session = await s.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: project.price_cents,
          product_data: { name: `DIY plan: ${project.title}` },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      application_fee_amount: feeCents(project.price_cents),
      transfer_data: { destination: seller.stripe_account_id },
    },
    metadata: {
      type: "plan_purchase",
      projectId: project.id,
      buyerId: user.id,
      sellerId: project.user_id,
    },
    success_url: `${base}/p/${project.slug}?bought=1`,
    cancel_url: `${base}/p/${project.slug}`,
  });

  return NextResponse.json({ url: session.url });
}
