// src/document/apply.ts
// Pure string-manipulation helpers for the documentation engine. No I/O.
//
//   * planDocstringInsertion — locate the insertion point for a symbol's
//     docstring and return a LineInsertion (so docstrings and inline comments
//     share one bottom-up splice path and can never disagree on line math).
//   * insertDocstring — convenience wrapper: plan + apply in one call.
//   * normalizeDocstringContent — strip any wrapping an LLM added.
//   * appendChangelog — prepend a new [Unreleased] section to a CHANGELOG.
//
// If the symbol header can't be found the plan is `null`, so a stale or
// misrouted patch can never corrupt the file.

import { type LineInsertion, applyLineInsertions } from './line-edits.js';

export type Language = 'python' | 'typescript';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function leadingWhitespace(line: string): string {
  const m = /^(\s*)/.exec(line);
  return m && m[1] !== undefined ? m[1] : '';
}

/**
 * Strip any wrapping an LLM may have added around a docstring body — surrounding
 * triple quotes (collapsing `""""""` and deeper), `/** *\/` delimiters, and
 * code fences — so the insert helpers wrap the content exactly once. Defensive:
 * the model is told to return bare content, but is not trusted to.
 */
export function normalizeDocstringContent(language: Language, raw: string): string {
  let s = raw.trim();
  s = s
    .replace(/^```[A-Za-z0-9_-]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  if (language === 'python') {
    let changed = true;
    while (changed) {
      changed = false;
      for (const q of ['"""', "'''"]) {
        if (s.length >= q.length * 2 && s.startsWith(q) && s.endsWith(q)) {
          s = s.slice(q.length, s.length - q.length).trim();
          changed = true;
        }
      }
    }
  } else if (s.startsWith('/**') && s.endsWith('*/')) {
    s = s.slice(3, s.length - 2).trim();
    s = s
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim();
  }
  return s;
}

function planPythonDocstring(
  source: string,
  symbol: string,
  content: string,
): LineInsertion | null {
  const lines = source.split('\n');
  const sym = escapeRegex(symbol);
  const defRe = new RegExp(`^(\\s*)(async\\s+)?def\\s+${sym}\\s*\\(`);
  const classRe = new RegExp(`^(\\s*)class\\s+${sym}\\b`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!defRe.test(line) && !classRe.test(line)) continue;
    const headerIndent = leadingWhitespace(line).length;

    // Walk forward to the first body line, skipping a multi-line signature.
    let bodyIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const cand = lines[j] ?? '';
      if (cand.trim() === '') continue;
      const candIndent = leadingWhitespace(cand).length;
      if (candIndent <= headerIndent) {
        const stripped = cand.trim();
        if (
          stripped.startsWith(')') ||
          stripped.endsWith(',') ||
          stripped.endsWith('(') ||
          stripped.endsWith('->')
        ) {
          continue;
        }
        return null; // no body found
      }
      bodyIdx = j;
      break;
    }
    if (bodyIdx === -1) return null;

    const bodyIndent = leadingWhitespace(lines[bodyIdx] ?? '');
    const parts = content.split('\n');
    let docLines: string[];
    if (parts.length === 1) {
      docLines = [`${bodyIndent}"""${parts[0]}"""`];
    } else {
      docLines = [
        `${bodyIndent}"""${parts[0]}`,
        ...parts.slice(1).map((p) => (p === '' ? '' : `${bodyIndent}${p}`)),
      ];
      const last = docLines.length - 1;
      docLines[last] = `${docLines[last]}"""`;
    }
    return { line: bodyIdx + 1, lines: docLines };
  }
  return null;
}

function planTypeScriptDocstring(
  source: string,
  symbol: string,
  content: string,
): LineInsertion | null {
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
    const parts = content.split('\n');
    let docLines: string[];
    if (parts.length === 1) {
      docLines = [`${indent}/** ${parts[0]} */`];
    } else {
      docLines = [
        `${indent}/**`,
        ...parts.map((p) => `${indent} *${p === '' ? '' : ` ${p}`}`),
        `${indent} */`,
      ];
    }
    return { line: i + 1, lines: docLines };
  }
  return null;
}

/**
 * Plan the insertion of a docstring for `symbol` into `source`. Returns the
 * LineInsertion (1-indexed line to insert above + the formatted lines), or
 * `null` when the symbol header can't be located. The LLM's `content` is
 * normalized first, so a wrapped answer never double-wraps.
 */
export function planDocstringInsertion(
  language: Language,
  source: string,
  symbol: string,
  content: string,
): LineInsertion | null {
  const normalized = normalizeDocstringContent(language, content);
  if (normalized === '') return null;
  return language === 'python'
    ? planPythonDocstring(source, symbol, normalized)
    : planTypeScriptDocstring(source, symbol, normalized);
}

/**
 * Insert a docstring into `source` for the named symbol. Convenience wrapper
 * over `planDocstringInsertion` + `applyLineInsertions`. Returns `source`
 * unchanged when the symbol can't be located.
 */
export function insertDocstring(
  language: Language,
  source: string,
  symbol: string,
  content: string,
): string {
  const plan = planDocstringInsertion(language, source, symbol, content);
  return plan ? applyLineInsertions(source, [plan]) : source;
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

  let insertAt = h1Idx + 1;
  while (insertAt < lines.length && (lines[insertAt] ?? '').trim() === '') {
    insertAt++;
  }
  const headerBlock = `${lines.slice(0, h1Idx + 1).join('\n')}\n\n`;
  const after = lines.slice(insertAt).join('\n');
  return `${headerBlock}${newSection}${after}`;
}
