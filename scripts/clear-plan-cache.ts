/**
 * Clears the plan_cache table. Run against the production env whenever a
 * deploy changes prompts, models, effort, tier or review mode — the request
 * hash salts those in, but truncating guarantees no stale hits.
 *
 *   npx tsx --env-file-if-exists=.env.production.local scripts/clear-plan-cache.ts
 *
 * or with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY exported.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment."
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// PostgREST requires a filter on delete — request_hash is never empty.
const { error, count } = await supabase
  .from("plan_cache")
  .delete({ count: "exact" })
  .neq("request_hash", "");

if (error) {
  console.error("plan_cache clear failed:", error.message);
  process.exit(1);
}
console.log(`plan_cache cleared — ${count ?? "unknown"} rows deleted.`);
