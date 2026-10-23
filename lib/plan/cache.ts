import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan } from "./schema";

/**
 * Plan caching (brief §4): identical normalized requests — same images,
 * same inputs, same prompt version — return the checked plan instantly.
 */

export interface CachedPlan {
  plan: Plan;
  unverified: string[];
  blockers: string[];
  warnings: string[];
  reviewPending: boolean;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}

export function requestHash(
  payload: Record<string, unknown>,
  imageDataUrls: string[],
  promptVersion: string
): string {
  const h = createHash("sha256");
  h.update(promptVersion);
  h.update(JSON.stringify(sortKeys(payload)));
  for (const img of imageDataUrls) h.update(createHash("sha256").update(img).digest());
  return h.digest("hex");
}

export async function cachedPlan(
  supabase: SupabaseClient,
  hash: string
): Promise<CachedPlan | null> {
  const { data } = await supabase
    .from("plan_cache")
    .select("result")
    .eq("request_hash", hash)
    .maybeSingle();
  const r = data?.result as CachedPlan | undefined;
  return r?.plan ? r : null;
}

export async function storePlan(
  supabase: SupabaseClient,
  hash: string,
  promptVersion: string,
  result: CachedPlan
): Promise<void> {
  await supabase
    .from("plan_cache")
    .upsert({ request_hash: hash, prompt_version: promptVersion, result });
}
