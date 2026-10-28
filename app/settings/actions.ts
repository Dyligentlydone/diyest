"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toolsFromFormData } from "@/lib/tools";

export type SettingsState = { error?: string; saved?: boolean };

const settingsSchema = z.object({
  display_name: z.string().trim().max(80).optional().or(z.literal("")),
  units: z.enum(["metric", "imperial"]),
  skill_level: z.enum(["beginner", "intermediate", "advanced"]),
  kerf_mm: z.coerce.number().min(0).max(10).default(3),
  tools_owned: z.array(z.string().trim().min(1).max(80)).max(80).default([]),
});

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const parsed = settingsSchema.safeParse({
    display_name: formData.get("display_name"),
    units: formData.get("units"),
    skill_level: formData.get("skill_level"),
    kerf_mm: formData.get("kerf_mm"),
    tools_owned: toolsFromFormData(formData),
  });
  if (!parsed.success) return { error: "Check the form values and try again." };

  try {
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      display_name: parsed.data.display_name || null,
      units: parsed.data.units,
      skill_level: parsed.data.skill_level,
      kerf_mm: parsed.data.kerf_mm,
      tools_owned: parsed.data.tools_owned,
    });
    if (error) return { error: `Could not save settings: ${error.message}` };
  } catch (e) {
    return { error: `Could not save settings: ${e instanceof Error ? e.message : "unknown"}` };
  }
  revalidatePath("/settings");
  return { saved: true };
}

export type PasswordState = { error?: string; saved?: boolean };

/** Set or change the account password — works for magic-link-created accounts too. */
export async function updatePassword(
  _prev: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };
  if (password !== String(formData.get("password_confirm") ?? ""))
    return { error: "Passwords don't match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not set the password. Try again." };
  return { saved: true };
}
