import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = requestOrigin(request);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/projects";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
