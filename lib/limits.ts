/**
 * Per-plan allowances by access level (brief §7). In M4 the counters are
 * tracked on the project row and these limits are enforced SOFTLY — the API
 * increments and reports usage; M6 turns enforcement on with real limits,
 * credits and Stripe. Keep every limit here, never hard-coded in routes.
 */

export type AccessLevel = "basic" | "intermediate" | "pro";

export interface PlanAllowances {
  /** Modify / Fit my space / cheaper / upgrade / restyle — per plan */
  modifications: number;
  /** "I'm stuck" chat messages (incl. photo checks) — per plan */
  chatMessages: number;
  /** blueprint/PDF downloads, templates, build mode, journal */
  downloads: boolean;
  buildMode: boolean;
}

export const ALLOWANCES: Record<AccessLevel, PlanAllowances> = {
  basic: { modifications: 0, chatMessages: 3, downloads: false, buildMode: false },
  intermediate: { modifications: 3, chatMessages: 10, downloads: true, buildMode: true },
  pro: {
    modifications: Number.POSITIVE_INFINITY,
    chatMessages: Number.POSITIVE_INFINITY,
    downloads: true,
    buildMode: true,
  },
};

export function allowancesFor(level: AccessLevel | null | undefined): PlanAllowances {
  return ALLOWANCES[level ?? "basic"];
}

export interface UsageCheck {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

export function checkAllowance(
  level: AccessLevel | null | undefined,
  kind: "modifications" | "chatMessages",
  used: number
): UsageCheck {
  const limit = allowancesFor(level)[kind];
  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}
