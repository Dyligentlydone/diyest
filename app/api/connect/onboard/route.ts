import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { stripe } from "@/lib/billing";
import { connectAccountId, onboardingLink } from "@/lib/connect";

/**
 * POST — start (or resume) Stripe Express onboarding for the signed-in
 * creator. Returns { url } to redirect the browser to.
 */
export async function POST() {
  const s = stripe();
  if (!s || !isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  try {
    const acctId = await connectAccountId(user.id, user.email);
    if (!acctId)
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    const url = await onboardingLink(acctId);
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start onboarding" },
      { status: 500 }
    );
  }
}
