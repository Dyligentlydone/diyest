/**
 * Model pricing — per 1M tokens, Standard tier (see docs/MODEL-ROUTING-PLAN.md
 * §2, checked Oct 22 2026). Flex tier ≈ half of Standard. Re-check the pricing
 * page before launch.
 *
 * Reasoning tokens are billed as output tokens.
 */
export interface Price {
  input: number;
  cachedInput: number;
  output: number;
}

export const PRICES: Record<string, Price> = {
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10.0 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  o3: { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "o3-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 },
  "o4-mini": { input: 1.1, cachedInput: 0.275, output: 4.4 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6.1-sol": { input: 2.0, cachedInput: 0.1, output: 10.0 },
  "gpt-6-astra": { input: 10.0, cachedInput: 1.0, output: 50.0 },
};

/**
 * Tier multipliers on Standard pricing. Flex ≈ 50%. Priority ("Fast") tier
 * pricing isn't published for these SKUs — billed at Standard until the
 * pricing page confirms; re-check before launch.
 */
const TIER_FACTORS: Record<string, number> = { flex: 0.5, priority: 1 };

export interface TokenUsage {
  inputTokens: number;
  cachedTokens: number;
  /** includes reasoning tokens */
  outputTokens: number;
  reasoningTokens: number;
}

export function costUsd(model: string, u: TokenUsage, tier?: string): number {
  const p = PRICES[model];
  if (!p) return 0;
  const f = tier ? (TIER_FACTORS[tier] ?? 1) : 1;
  const uncached = Math.max(0, u.inputTokens - u.cachedTokens);
  return (
    (uncached * p.input + u.cachedTokens * p.cachedInput + u.outputTokens * p.output) /
    1_000_000
  ) * f;
}

/** One logged model call (§8 guardrail: per-call cost logging). */
export interface CallRecord {
  stage: string;
  model: string;
  tier: string;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
}

/** Per-plan hard cost cap — escalation stops once running cost reaches it. */
export function planCostCapUsd(): number {
  return Number(process.env.PLAN_COST_CAP_USD ?? "0.6") || 0.6;
}

export function dailySpendAlertUsd(): number {
  return Number(process.env.DAILY_SPEND_ALERT_USD ?? "5") || 5;
}
