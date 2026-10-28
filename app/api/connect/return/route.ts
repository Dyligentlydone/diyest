import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { stripe } from "@/lib/billing";
import { syncConnectStatus } from "@/lib/connect";

/**
 * GET — return URL from Stripe onboarding. Sync capability flags and drop
 * the creator back in Settings.
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
  if (!prof?.stripe_account_id) redirect("/settings?payouts=incomplete");

  await syncConnectStatus(prof.stripe_account_id);
  redirect("/settings?payouts=done");
}
