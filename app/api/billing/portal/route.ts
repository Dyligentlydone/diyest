import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appUrl, billingState, stripe } from "@/lib/billing";
import { isSupabaseConfigured } from "@/lib/env";

/** POST → Stripe customer portal session (manage/cancel subscription). */
export async function POST() {
  const s = stripe();
  if (!s || !isSupabaseConfigured())
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "sign_in" }, { status: 401 });

  const billing = await billingState(user.id);
  if (!billing.customerId)
    return NextResponse.json(
      { error: "No billing account yet" },
      { status: 400 }
    );

  const session = await s.billingPortal.sessions.create({
    customer: billing.customerId,
    return_url: `${appUrl()}/settings`,
  });
  return NextResponse.json({ url: session.url });
}
