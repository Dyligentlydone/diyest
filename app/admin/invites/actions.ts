"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/site-mode";
import { createServiceClient } from "@/lib/supabase/server";

export async function createCodes(formData: FormData) {
  await requireAdmin();
  const supabase = createServiceClient();

  const label = String(formData.get("label") ?? "").trim() || null;
  const maxUses = Math.max(1, Number(formData.get("maxUses") ?? 1) || 1);
  const grantLevel = ["basic", "intermediate", "pro"].includes(
    String(formData.get("grantLevel"))
  )
    ? String(formData.get("grantLevel"))
    : "pro";
  const grantDaysRaw = String(formData.get("grantDays") ?? "").trim();
  const grantDaysNum = Number(grantDaysRaw);
  const grantDays =
    grantDaysRaw && Number.isFinite(grantDaysNum) && grantDaysNum > 0
      ? Math.floor(grantDaysNum)
      : null;
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null;

  // single code or batch: "PREFIX" + count → PREFIX-1, PREFIX-2, …
  const single = String(formData.get("code") ?? "").trim().toUpperCase();
  const prefix = String(formData.get("prefix") ?? "").trim().toUpperCase();
  const count = Math.min(500, Math.max(0, Number(formData.get("count") ?? 0) || 0));

  const rows: Record<string, unknown>[] = [];
  if (single) rows.push({ code: single.replace(/\s+/g, "") });
  for (let i = 1; i <= count; i++)
    rows.push({ code: `${prefix || "BETA"}-${i}` });

  if (!rows.length) throw new Error("Enter a code or a batch prefix+count");

  const { error } = await supabase.from("invite_codes").insert(
    rows.map((r) => ({
      ...r,
      label,
      max_uses: maxUses,
      grant_access_level: grantLevel,
      grant_days: grantDays,
      expires_at: expiresAt,
    }))
  );
  if (error) throw new Error(`Could not create codes: ${error.message}`);
  revalidatePath("/admin/invites");
}

export async function deactivateCode(formData: FormData) {
  await requireAdmin();
  const supabase = createServiceClient();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  if (!id) return;
  await supabase.from("invite_codes").update({ is_active: !active }).eq("id", id);
  revalidatePath("/admin/invites");
}
