import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { grantPlanCredits, stripe, tierFromPriceId } from "@/lib/billing";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Stripe webhook — the only writer of subscription/credit state.
 * Configure: POST /api/billing/webhook with events
 * checkout.session.completed, customer.subscription.*, invoice.payment_failed
 */
export async function POST(request: NextRequest) {
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret || !isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const sig = request.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(await request.text(), sig, secret);
  } catch (e) {
    return NextResponse.json(
      { error: `Signature failed: ${e instanceof Error ? e.message : e}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  async function userIdForCustomer(customerId: string): Promise<string | null> {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    return data?.id ?? null;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        // one-time single-plan purchase → +1 credit; subscription state is
        // handled by customer.subscription.* events
        if (session.mode === "payment" && session.metadata?.plan === "single" && userId)
          await grantPlanCredits(userId);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId =
          (sub.metadata?.userId as string | undefined) ??
          (typeof sub.customer === "string"
            ? await userIdForCustomer(sub.customer)
            : null);
        if (!userId) break;
        // Stripe ≥2025 keeps period bounds on the subscription item
        const item = sub.items?.data?.[0] as
          | (Stripe.SubscriptionItem & {
              current_period_start?: number;
              current_period_end?: number;
            })
          | undefined;
        const priceId = item?.price?.id ?? null;
        await supabase.from("subscriptions").upsert(
          {
            user_id: userId,
            stripe_subscription_id: sub.id,
            stripe_customer_id:
              typeof sub.customer === "string" ? sub.customer : null,
            stripe_price_id: priceId,
            plan_tier: priceId ? tierFromPriceId(priceId) : null,
            status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
            current_period_start: item?.current_period_start
              ? new Date(item.current_period_start * 1000).toISOString()
              : null,
            current_period_end: item?.current_period_end
              ? new Date(item.current_period_end * 1000).toISOString()
              : null,
          },
          { onConflict: "user_id" }
        );
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customer =
          typeof invoice.customer === "string" ? invoice.customer : null;
        const userId = customer ? await userIdForCustomer(customer) : null;
        if (userId)
          await supabase
            .from("subscriptions")
            .update({ status: "past_due" })
            .eq("user_id", userId);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[billing webhook]", event.type, e);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
