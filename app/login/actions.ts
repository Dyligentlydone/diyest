"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string; sent?: boolean; email?: string; signup?: boolean };

const emailSchema = z.string().trim().toLowerCase().email();

function safeNext(raw: unknown): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/projects";
}

export async function signInWithEmail(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL;
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext(formData.get("next")))}`,
    },
  });

  if (error) return { error: "Could not send the sign-in link. Try again." };
  return { sent: true, email: parsed.data };
}

const passwordSchema = z.string().min(8, "Password must be at least 8 characters.");

/** Email + password sign-in for accounts that already have a password set. */
export async function signInWithPassword(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Enter your password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data,
    password,
  });
  if (error) return { error: "Invalid email or password." };
  redirect(safeNext(formData.get("next")));
}

/** Email + password sign-up — Supabase emails a confirmation link. */
export async function signUpWithPassword(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL;
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const pwd = passwordSchema.safeParse(formData.get("password"));
  if (!pwd.success) return { error: pwd.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data,
    password: pwd.data,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext(formData.get("next")))}`,
    },
  });
  if (error) return { error: "Could not create the account — try again." };
  return { sent: true, email: parsed.data, signup: true };
}

export async function signInWithGoogle(formData: FormData) {
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext(formData.get("next")))}`,
    },
  });

  if (error || !data.url) redirect("/login?error=auth");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
