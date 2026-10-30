import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, requestOrigin } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { unsubscribeToken } from "@/lib/waitlist";

/** GET — one-click marketing unsubscribe: /waitlist/unsubscribe?e=<email>&t=<token> */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = url.searchParams.get("e") ?? "";
  const token = url.searchParams.get("t") ?? "";
  const base = requestOrigin(request);
  if (!email || !token || !isSupabaseConfigured())
    return NextResponse.redirect(`${base}/?unsub=invalid`);
  if (unsubscribeToken(email) !== token)
    return NextResponse.redirect(`${base}/?unsub=invalid`);

  const supabase = createServiceClient();
  await supabase
    .from("waitlist")
    .update({ marketing_opt_in: false })
    .eq("email", email.trim().toLowerCase());
  return NextResponse.redirect(`${base}/?unsub=ok`);
}
