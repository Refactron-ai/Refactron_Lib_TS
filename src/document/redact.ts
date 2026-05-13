/**
 * Secret redaction for documentation prompts.
 *
 * Replaces well-known credential shapes with `[REDACTED:kind]` markers before
 * source is shipped to a remote LLM. Patterns are applied in declaration order
 * so that more-specific kinds (e.g. anthropic's `sk-ant-` prefix) consume
 * their span before a broader pattern (openai's `sk-`) can match it.
 *
 * Custom user-supplied patterns run last and tag as `[REDACTED:custom]`.
 * Invalid regexes are silently skipped — a typo in user config must not
 * disable the built-in bank.
 */

interface RedactionPattern {
  kind: string;
  re: RegExp;
}

// Order matters. Anthropic precedes OpenAI because both share the `sk-`
// prefix. JWT precedes env-style assignment so a JWT inside an env line is
// reported with the more specific kind.
const BUILT_IN_PATTERNS: readonly RedactionPattern[] = [
  // Anthropic API keys: sk-ant-...<20+ url-safe chars>
  { kind: 'anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  // OpenAI API keys: sk-...<20+ url-safe chars>
  { kind: 'openai', re: /sk-[A-Za-z0-9_-]{20,}/g },
  // AWS access key ids: AKIA + 16 uppercase alphanumerics
  { kind: 'aws', re: /AKIA[0-9A-Z]{16}/g },
  // GitHub personal access tokens / app tokens
  { kind: 'github', re: /gh[pousr]_[A-Za-z0-9]{36}/g },
  // JWT-ish: three dot-separated url-safe base64 segments, each 20+ chars
  { kind: 'jwt', re: /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  // .env-style assignments. Either:
  //   (a) the key looks like a secret (contains PASSWORD/SECRET/TOKEN or ends in _KEY/KEY)
  //   (b) the key is fully upper-snake (>=4 chars) with an opaque 16+ char value
  // followed by `=` and a 16+ char opaque value. The `=` must have no spaces
  // around it so we don't catch `x = 5` or `let name = "alice"`.
  {
    kind: 'env',
    re: /\b(?:[A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN)[A-Z0-9_]*|[A-Z][A-Z0-9_]*_KEY|[A-Z][A-Z0-9_]{3,}KEY|[A-Z][A-Z0-9_]{3,})=[A-Za-z0-9_\-+/=]{16,}/g,
  },
];

/** Replace secret-like substrings with `[REDACTED:kind]` markers. */
export function redact(text: string, customPatterns: string[]): string {
  let out = text;

  for (const { kind, re } of BUILT_IN_PATTERNS) {
    out = out.replace(re, `[REDACTED:${kind}]`);
  }

  for (const source of customPatterns) {
    let re: RegExp;
    try {
      re = new RegExp(source, 'g');
    } catch {
      // Invalid user regex — skip without disturbing built-in redactions.
      continue;
    }
    out = out.replace(re, '[REDACTED:custom]');
  }

  return out;
}
