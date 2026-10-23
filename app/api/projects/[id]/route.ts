import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { randomBytes } from "crypto";

/** short URL-safe slug for share pages */
const newSlug = () => randomBytes(8).toString("base64url");

const patchSchema = z.object({
  status: z.enum(["planned", "in_progress", "done"]).optional(),
  is_public: z.boolean().optional(),
  category: z
    .enum(["tables", "shelves", "storage", "outdoor", "kids", "seating", "desks", "other"])
    .nullable()
    .optional(),
  title: z.string().min(1).max(120).optional(),
});

/** PATCH — status / sharing / category changes (owner only via RLS). */
export async function PATCH(
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

  let patch: z.infer<typeof patchSchema>;
  try {
    patch = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (patch.status) update.status = patch.status;
  if (patch.title) update.title = patch.title;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.is_public !== undefined) {
    update.is_public = patch.is_public;
    // first share → mint a slug; unsharing keeps it for easy re-share
    if (patch.is_public) {
      const { data: proj } = await supabase
        .from("projects")
        .select("slug")
        .eq("id", id)
        .maybeSingle();
      if (!proj?.slug) update.slug = newSlug();
    }
  }
  if (!Object.keys(update).length)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { data, error } = await supabase
    .from("projects")
    .update(update)
    .eq("id", id)
    .select("id, slug, is_public, status, category")
    .single();
  if (error) return NextResponse.json({ error: "Could not update" }, { status: 500 });
  return NextResponse.json({ ok: true, project: data });
}
