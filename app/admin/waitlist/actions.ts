"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/site-mode";
import { createServiceClient } from "@/lib/supabase/server";
import { inviteEmail, inviteLink, sendEmail } from "@/lib/email";
import { computePosition, type WaitlistEntry } from "@/lib/waitlist";

/**
 * Send single-use invite codes to the top N confirmed, not-yet-invited
 * people on the waitlist. Marks invited_at so a re-run skips them.
 */
export async function inviteNextN(formData: FormData) {
  const { userId } = await requireAdmin();
  const supabase = createServiceClient();
  const n = Math.min(500, Math.max(1, Number(formData.get("n") ?? 0) || 0));

  const { data: all } = await supabase
    .from("waitlist")
    .select("id, email, seq, referral_code, referral_count, confirmed_at, invited_at")
    .not("confirmed_at", "is", null)
    .is("invited_at", null)
    .order("seq")
    .limit(10000);
  if (!all?.length) return;

  const sorted = (all as (WaitlistEntry & { id: string; email: string; referral_code: string })[])
    .map((w) => ({ ...w, pos: computePosition(w, all as WaitlistEntry[]) }))
    .sort((a, b) => a.pos - b.pos)
    .slice(0, n);

  for (const w of sorted) {
    const code = `WL-${w.referral_code}`;
    await supabase.from("invite_codes").upsert(
      {
        code,
        label: "waitlist",
        max_uses: 1,
        grant_access_level: "pro",
        grant_days: null,
        created_by: userId,
      },
      { onConflict: "code" }
    );
    const mail = inviteEmail({ code, inviteUrl: inviteLink(code) });
    await sendEmail({ to: w.email, ...mail });
    await supabase
      .from("waitlist")
      .update({ invited_at: new Date().toISOString() })
      .eq("id", w.id);
  }
  revalidatePath("/admin/waitlist");
  revalidatePath("/admin/invites");
}
