import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

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
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_IMAGE_BYTES)
      return NextResponse.json({ error: "Photo too large" }, { status: 400 });
    const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
    imagePath = `${user.id}/${id}/journal-${Date.now()}.${ext}`;
    const { error: up } = await supabase.storage
      .from("project-images")
      .upload(imagePath, buf, {
        contentType: m[1],
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

  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", entryId)
    .eq("project_id", id);
  if (error)
    return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
