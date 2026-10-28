import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { recordUsage } from "@/lib/usage";
import { denyIfNoInvite } from "@/lib/site-mode";

/**
 * POST — clone a public project into the caller's account. No generation
 * calls — the plan is copied verbatim (brief §4: gallery clones reuse plans).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sign in to copy this plan" }, { status: 401 });
  const denied1 = await denyIfNoInvite(user.id);
  if (denied1) return denied1;

  const { data: source } = await supabase
    .from("projects")
    .select(
      "title, mode, plan, input, prompt_version, category, is_public, user_id, price_cents"
    )
    .eq("id", id)
    .maybeSingle();

  // own projects can always be duplicated; others' only when public
  if (!source || (!source.is_public && source.user_id !== user.id))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // priced plans: only the owner or a paying buyer can copy
  if (source.price_cents && source.user_id !== user.id) {
    const { data: purchase } = await supabase
      .from("plan_purchases")
      .select("id")
      .eq("project_id", id)
      .eq("buyer_id", user.id)
      .is("refunded_at", null)
      .maybeSingle();
    if (!purchase)
      return NextResponse.json(
        { error: "purchase_required" },
        { status: 402 }
      );
  }

  const { data: copy, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      title: source.title,
      mode: source.mode,
      plan: source.plan,
      input: source.input,
      prompt_version: source.prompt_version,
      category: source.category,
      status: "planned",
    })
    .select("id")
    .single();
  if (error)
    return NextResponse.json({ error: "Could not copy project" }, { status: 500 });

  void recordUsage(user.id, "plan_clone");
  return NextResponse.json({ ok: true, id: copy.id });
}
