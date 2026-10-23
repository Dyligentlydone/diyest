import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

const schema = z.object({
  projectId: z.string().uuid().optional(),
  stepN: z.number().int().positive().nullable().optional(),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(2000).optional(),
});

/** POST — plan thumbs + per-step problem reports (anyone may post). */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { error } = await supabase.from("plan_feedback").insert({
    project_id: body.projectId ?? null,
    user_id: user?.id ?? null,
    step_n: body.stepN ?? null,
    rating: body.rating,
    comment: body.comment?.trim() || null,
  });
  if (error)
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
