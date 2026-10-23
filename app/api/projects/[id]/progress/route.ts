import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { denyIfNoInvite } from "@/lib/site-mode";

const schema = z.object({
  steps: z.array(z.number().int().positive()).max(500),
});

/** POST — replace the project's done-step set (build mode sync). */
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

  let steps: number[];
  try {
    steps = schema.parse(await request.json()).steps;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // replace the done-set: upsert current, delete the rest
  const { error: delErr } = await supabase
    .from("step_progress")
    .delete()
    .eq("project_id", id)
    .not("step_n", "in", `(${steps.join(",") || "0"})`);
  if (delErr)
    return NextResponse.json({ error: "Could not update" }, { status: 500 });
  if (steps.length) {
    const { error } = await supabase.from("step_progress").upsert(
      steps.map((n) => ({
        project_id: id,
        step_n: n,
        done: true,
        done_at: new Date().toISOString(),
      }))
    );
    if (error)
      return NextResponse.json({ error: "Could not update" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
