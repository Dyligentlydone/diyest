import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { denyIfNoInvite } from "@/lib/site-mode";

const schema = z.object({
  keys: z.array(z.string().max(200)).max(500),
});

/** POST — replace the project's shopping "already have" marks (owner only via RLS). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const denied1 = await denyIfNoInvite(user.id);
  if (denied1) return denied1;

  let keys: string[];
  try {
    keys = schema.parse(await request.json()).keys;
  } catch {
    return NextResponse.json({ error: "Invalid keys" }, { status: 400 });
  }

  const { error } = await supabase
    .from("projects")
    .update({ shopping_have: keys })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  return NextResponse.json({ ok: true, keys });
}
