import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { denyIfNoInvite } from "@/lib/site-mode";
import { stripImageMetadata } from "@/lib/image";

const postSchema = z.object({
  note: z.string().max(2000).default(""),
  /** data URL — uploaded to storage under the user's folder */
  image: z.string().optional(),
});

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** POST — add a dated journal entry (note + optional progress photo). */
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

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.note.trim() && !body.image)
    return NextResponse.json({ error: "Add a note or a photo" }, { status: 400 });

  let imagePath: string | null = null;
  if (body.image) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.image);
    if (!m)
      return NextResponse.json(
        { error: "Photo must be JPEG, PNG or WebP" },
        { status: 400 }
      );
    const raw = Buffer.from(m[2], "base64");
    if (raw.length > MAX_IMAGE_BYTES)
      return NextResponse.json({ error: "Photo too large" }, { status: 400 });
    // strip EXIF/GPS before storage — journal photos go on public pages
    const { buf, contentType } = await stripImageMetadata(raw);
    imagePath = `${user.id}/${id}/journal-${Date.now()}.jpg`;
    const { error: up } = await supabase.storage
      .from("project-images")
      .upload(imagePath, buf, {
        contentType,
        upsert: false,
      });
    if (up)
      return NextResponse.json({ error: "Photo upload failed" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("journal_entries")
    .insert({ project_id: id, note: body.note.trim(), image_path: imagePath })
    .select("id, note, image_path, created_at")
    .single();
  if (error)
    return NextResponse.json({ error: "Could not save entry" }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}

/** DELETE — remove a journal entry (?entry=<id>). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const { id } = await params;
  const entryId = request.nextUrl.searchParams.get("entry");
  if (!entryId)
    return NextResponse.json({ error: "Missing entry id" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const denied2 = await denyIfNoInvite(user.id);
  if (denied2) return denied2;

  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", entryId)
    .eq("project_id", id);
  if (error)
    return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
