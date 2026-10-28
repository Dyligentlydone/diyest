import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — must reference literal NEXT_PUBLIC_* properties so
 * Next.js inlines them into the client bundle at build time (dynamic
 * process.env[name] lookups evaluate to undefined in the browser).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
