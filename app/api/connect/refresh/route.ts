import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { stripe } from "@/lib/billing";
import { onboardingLink } from "@/lib/connect";

/**
 * GET — Stripe sends creators here when their onboarding link expires;
 * mint a fresh one and send them back into the flow.
 */
export async function GET() {
  if (!stripe() || !isSupabaseConfigured()) redirect("/settings");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings");

  const { data: prof } = await supabase
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.stripe_account_id) redirect("/settings");

  const url = await onboardingLink(prof.stripe_account_id);
  return NextResponse.redirect(url);
}
