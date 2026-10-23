import type { TokenUsage } from "./pricing";

const ZERO: TokenUsage = {
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

/** Normalize an OpenAI usage object → TokenUsage (reasoning counts as output). */
export function usageOf(
  u:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number } | null;
        completion_tokens_details?: { reasoning_tokens?: number } | null;
      }
    | null
    | undefined
): TokenUsage {
  if (!u) return { ...ZERO };
  return {
    inputTokens: u.prompt_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}
