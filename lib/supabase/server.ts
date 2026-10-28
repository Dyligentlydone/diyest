import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { requireEnv } from "@/lib/env";

export async function createClient() {
  // Marks the surrounding render/action as request-time. The Supabase auth
  // client calls Date.now() internally when loading a session, which Cache
  // Components treats as an unstable value during prerendering — this opts
  // every caller out of the static prerender path before it happens.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore because the
            // proxy refreshes sessions on every request.
          }
        },
      },
    }
  );
}

/** Service-role client. Bypasses RLS — server-side use only (webhooks, usage enforcement). */
export function createServiceClient() {
  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
