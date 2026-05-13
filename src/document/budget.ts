/**
 * Token-budget utilities for documentation prompts.
 *
 * The 4-chars-per-token heuristic is a deliberately rough approximation that
 * sidesteps a per-provider tokenizer dependency. It is intentionally
 * pessimistic for ASCII source code, which keeps us under budget in practice.
 */

/** Estimate token count via the 4-chars-per-token heuristic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * If text fits within `maxTokens`, return unchanged. Otherwise truncate the
 * middle, keeping the prefix and suffix halves of the character budget,
 * joined with a marker reporting how many newlines were elided.
 */
export function truncateToBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }

  const charBudget = maxTokens * 4;
  const halfBudget = Math.floor(charBudget / 2);
  const prefix = text.slice(0, halfBudget);
  const suffix = text.slice(text.length - halfBudget);
  const elided = text.slice(halfBudget, text.length - halfBudget);
  const newlinesElided = (elided.match(/\n/g) ?? []).length;

  return `${prefix}\n[... ${newlinesElided} lines elided ...]\n${suffix}`;
}
