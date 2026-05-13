/**
 * Idempotency check: detect whether a named symbol already carries
 * documentation, so the documentation engine can skip regenerating it.
 *
 * Python: the first non-blank line of the function/class body starts with a
 * string literal (triple-quoted or single-line quoted).
 * TypeScript: the line immediately above the declaration (skipping blanks)
 * ends with `*` / closes a JSDoc block — bare `//` comments do not count.
 */

export type Language = 'python' | 'typescript';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function leadingWhitespaceLength(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m && m[1] !== undefined ? m[1].length : 0;
}

function pythonHasDocstring(symbol: string, source: string): boolean {
  const lines = source.split('\n');
  const sym = escapeRegex(symbol);
  const defRe = new RegExp(`^(\\s*)(async\\s+)?def\\s+${sym}\\s*\\(`);
  const classRe = new RegExp(`^(\\s*)class\\s+${sym}\\b`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = defRe.exec(line) ?? classRe.exec(line);
    if (!match) continue;
    const headerIndent = leadingWhitespaceLength(line);

    // Header may span multiple physical lines (params on next lines). Skip
    // forward until we see a line ending with ':' that closes the signature,
    // or just scan onward — for our purposes finding the first body line
    // (indent > headerIndent) is sufficient.
    for (let j = i + 1; j < lines.length; j++) {
      const cand = lines[j] ?? '';
      if (cand.trim() === '') continue;
      const candIndent = leadingWhitespaceLength(cand);
      if (candIndent <= headerIndent) {
        // Still part of the header (e.g. closing paren at same indent) or
        // we've exited the body without finding a docstring.
        const stripped = cand.trim();
        // Continuation of a multi-line signature: keep scanning.
        if (
          stripped.startsWith(')') ||
          stripped.endsWith(',') ||
          stripped.endsWith('(') ||
          stripped.endsWith('->')
        ) {
          continue;
        }
        return false;
      }
      const body = cand.trimEnd().slice(candIndent);
      if (
        body.startsWith('"""') ||
        body.startsWith("'''") ||
        body.startsWith('"') ||
        body.startsWith("'")
      ) {
        return true;
      }
      return false;
    }
    return false;
  }
  return false;
}

function typescriptHasDocstring(symbol: string, source: string): boolean {
  const lines = source.split('\n');
  const sym = escapeRegex(symbol);
  const declRes = [
    new RegExp(`^(\\s*)(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${sym}\\b`),
    new RegExp(`^(\\s*)(export\\s+)?(abstract\\s+)?class\\s+${sym}\\b`),
    new RegExp(`^(\\s*)(export\\s+)?(const|let|var)\\s+${sym}\\s*[:=]`),
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!declRes.some((re) => re.test(line))) continue;

    // Walk backwards past blank lines.
    let j = i - 1;
    while (j >= 0 && (lines[j] ?? '').trim() === '') j--;
    if (j < 0) return false;
    const prev = (lines[j] ?? '').trimEnd();
    if (prev.endsWith('*/')) return true;
    return false;
  }
  return false;
}

export function hasExistingDocstring(
  language: Language,
  symbol: string,
  source: string,
): boolean {
  if (language === 'python') return pythonHasDocstring(symbol, source);
  return typescriptHasDocstring(symbol, source);
}
