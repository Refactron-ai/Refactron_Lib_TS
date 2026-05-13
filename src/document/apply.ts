// src/document/apply.ts
// Pure string-manipulation helpers for the documentation engine. No I/O.
//
// Two operations:
//   * insertDocstring — splice a docstring into source for a named symbol.
//   * appendChangelog — prepend a new [Unreleased] section to a CHANGELOG.
//
// Idempotency is intentionally the caller's responsibility — callers should
// run `hasExistingDocstring` first. If the symbol header can't be found, the
// source is returned unchanged so a stale or misrouted patch can never
// corrupt the file.

export type Language = 'python' | 'typescript';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function leadingWhitespace(line: string): string {
  const m = /^(\s*)/.exec(line);
  return m && m[1] !== undefined ? m[1] : '';
}

function insertPythonDocstring(source: string, symbol: string, content: string): string {
  const lines = source.split('\n');
  const sym = escapeRegex(symbol);
  const defRe = new RegExp(`^(\\s*)(async\\s+)?def\\s+${sym}\\s*\\(`);
  const classRe = new RegExp(`^(\\s*)class\\s+${sym}\\b`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!defRe.test(line) && !classRe.test(line)) continue;
    const headerIndent = leadingWhitespace(line).length;

    // Walk forward to the first non-blank line that constitutes the body.
    // Skip continuation lines of a multi-line signature.
    let bodyIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const cand = lines[j] ?? '';
      if (cand.trim() === '') continue;
      const candIndent = leadingWhitespace(cand).length;
      if (candIndent <= headerIndent) {
        // Either a continuation of the signature or we already exited.
        const stripped = cand.trim();
        if (
          stripped.startsWith(')') ||
          stripped.endsWith(',') ||
          stripped.endsWith('(') ||
          stripped.endsWith('->')
        ) {
          continue;
        }
        // No body found — give up.
        return source;
      }
      bodyIdx = j;
      break;
    }
    if (bodyIdx === -1) return source;

    const bodyIndent = leadingWhitespace(lines[bodyIdx] ?? '');
    let docLine: string;
    if (content.includes('\n')) {
      const parts = content.split('\n');
      const first = parts[0] ?? '';
      const rest = parts.slice(1);
      const indented = rest.map((p) => `${bodyIndent}${p}`).join('\n');
      docLine = `${bodyIndent}"""${first}\n${indented}"""`;
    } else {
      docLine = `${bodyIndent}"""${content}"""`;
    }

    const before = lines.slice(0, bodyIdx);
    const after = lines.slice(bodyIdx);
    return [...before, docLine, ...after].join('\n');
  }
  return source;
}

function insertTypeScriptDocstring(source: string, symbol: string, content: string): string {
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
    const indent = leadingWhitespace(line);

    let docLine: string;
    if (content.includes('\n')) {
      const parts = content.split('\n');
      const body = parts.map((p) => `${indent} * ${p}`).join('\n');
      docLine = `${indent}/**\n${body}\n${indent} */`;
    } else {
      docLine = `${indent}/** ${content} */`;
    }

    const before = lines.slice(0, i);
    const after = lines.slice(i);
    return [...before, docLine, ...after].join('\n');
  }
  return source;
}

/**
 * Insert a docstring into `source` for the named symbol.
 *
 * Python: inserts as the first body statement after the def/class header;
 *   indentation matches the body indent.
 * TypeScript: inserts a /** ... *\/ block above the declaration; the
 *   declaration's leading indentation is preserved.
 *
 * Idempotency is the caller's responsibility; if the symbol cannot be
 * located, `source` is returned unchanged.
 */
export function insertDocstring(
  language: Language,
  source: string,
  symbol: string,
  content: string,
): string {
  if (language === 'python') return insertPythonDocstring(source, symbol, content);
  return insertTypeScriptDocstring(source, symbol, content);
}

/**
 * Prepend a new [Unreleased] section above existing entries.
 *
 * If `existing` is empty, builds a fresh `# Changelog` scaffold. Otherwise,
 * the new section is inserted after the first `# Changelog` H1 line; if no
 * such heading exists, one is prepended.
 */
export function appendChangelog(existing: string, bullets: string[], date: string): string {
  const bulletBlock = bullets.join('\n');
  if (existing.trim() === '') {
    return `# Changelog\n\n## [Unreleased] — ${date}\n\n${bulletBlock}\n`;
  }

  const newSection = `## [Unreleased] — ${date}\n\n${bulletBlock}\n\n`;
  const lines = existing.split('\n');
  const h1Idx = lines.findIndex((l) => /^#\s+Changelog\b/i.test(l));
  if (h1Idx === -1) {
    return `# Changelog\n\n${newSection}${existing}`;
  }

  // Insert after the H1 line and the blank line that typically follows it.
  let insertAt = h1Idx + 1;
  while (insertAt < lines.length && (lines[insertAt] ?? '').trim() === '') {
    insertAt++;
  }
  const headerBlock = `${lines.slice(0, h1Idx + 1).join('\n')}\n\n`;
  const after = lines.slice(insertAt).join('\n');
  return `${headerBlock}${newSection}${after}`;
}
