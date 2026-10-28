import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { planSchema } from "@/lib/plan/schema";
import { isSupabaseConfigured } from "@/lib/env";
import { denyIfNoInvite } from "@/lib/site-mode";

const saveSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  mode: z
    .enum(["build", "fix", "space", "leftovers", "describe"])
    .default("build"),
  plan: planSchema,
  input: z.record(z.string(), z.unknown()).default({}),
  prompt_version: z.string().default("plan.v1.2"),
  imagePaths: z.array(z.string().max(500)).max(8).default([]),
  images: z.array(z.string()).max(8).default([]),
});

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sign in to save projects" }, { status: 401 });
  const denied1 = await denyIfNoInvite(user.id);
  if (denied1) return denied1;

  let body: z.infer<typeof saveSchema>;
  try {
    body = saveSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid plan data";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Only accept image paths inside the caller's own storage folder, plus upload
  // any base64 data-URL images sent directly from the draft client.
  const paths = body.imagePaths.filter((p) => p.startsWith(`${user.id}/`));
  for (const [i, d] of body.images.entries()) {
    const [head, b] = d.split(",");
    if (!head || !b) continue;
    const mime = head.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
    const ext = mime.includes("png") ? "png" : "jpg";
    const path = `${user.id}/${body.id}/input-${i}.${ext}`;
    const buf = Buffer.from(b, "base64");
    const { error: upErr } = await supabase.storage
      .from("project-images")
      .upload(path, buf, { contentType: mime, upsert: true });
    if (!upErr) paths.push(path);
    else console.warn("[projects] image upload failed", upErr.message);
  }

  const { error } = await supabase.from("projects").insert({
    id: body.id,
    user_id: user.id,
    title: body.title,
    mode: body.mode,
    plan: body.plan,
    input: body.input,
    prompt_version: body.prompt_version,
    status: "planned",
  });
  if (error) {
    console.error("[projects] insert failed", error);
    return NextResponse.json({ error: "Could not save project" }, { status: 500 });
  }

  if (paths.length) {
    const { error: imgError } = await supabase.from("project_images").insert(
      paths.map((storage_path) => ({
        project_id: body.id,
        storage_path,
        kind: "input",
      }))
    );
    if (imgError) console.error("[projects] image rows failed", imgError);
  }

  return NextResponse.json({ id: body.id });
}
