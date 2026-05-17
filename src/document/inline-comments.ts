// src/document/inline-comments.ts
// Inline-comment generation support: number a source for the LLM, parse the
// strict-JSON it returns, and resolve each comment to a concrete, drift-safe
// insertion. A comment that cannot be uniquely placed is dropped — never
// guessed — so a stale or hallucinated anchor can't misplace a comment.

import type { Language } from './idempotency.js';
import type { LineInsertion } from './line-edits.js';

/** How far from the hinted line number an anchor may have drifted. */
const ANCHOR_WINDOW = 3;

export interface RawComment {
  /** 1-indexed line the model wants to comment (a hint, not trusted blindly). */
  line: number;
  /** Verbatim trimmed text of that line — the real anchor. */
  anchorContent: string;
  /** 1-based index when `anchorContent` repeats; defaults to 1. */
  occurrence: number;
  /** Comment text, one entry per rendered line, WITHOUT the comment marker. */
  comment: string[];
}

/** Prefix every line of `source` with a 1-indexed `NNN| ` marker for the LLM. */
export function numberSource(source: string): string {
  return source
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(4, ' ')}| ${l}`)
    .join('\n');
}

/** Parse the strict-JSON array the inline-comment prompt asks for. Malformed
 *  items are discarded individually; a wholly unparseable response yields []. */
export function parseRawComments(raw: string): RawComment[] {
  const text = raw
    .trim()
    .replace(/^```[A-Za-z0-9_-]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: RawComment[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.line !== 'number' || !Number.isInteger(o.line) || o.line < 1) continue;
    if (typeof o.anchorContent !== 'string' || o.anchorContent.trim() === '') continue;
    const commentLines = Array.isArray(o.comment)
      ? o.comment.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
      : typeof o.comment === 'string' && o.comment.trim() !== ''
        ? [o.comment]
        : [];
    if (commentLines.length === 0) continue;
    out.push({
      line: o.line,
      anchorContent: o.anchorContent.trim(),
      occurrence: typeof o.occurrence === 'number' && o.occurrence >= 1 ? o.occurrence : 1,
      comment: commentLines.map((c) => c.trim()),
    });
  }
  return out;
}

function leadingWhitespace(line: string): string {
  return /^(\s*)/.exec(line)?.[1] ?? '';
}

export interface ResolveResult {
  insertions: LineInsertion[];
  /** Comments dropped because their anchor could not be uniquely located. */
  dropped: number;
}

/** Resolved inline comments for a whole run, grouped by file. */
export interface InlineCommentPatch {
  files: Array<{ file: string; insertions: LineInsertion[] }>;
  /** Total comments dropped across all files (unresolved anchors). */
  dropped: number;
}

/**
 * Resolve raw LLM comments against the actual file content. Each comment is
 * anchored on the verbatim trimmed text of its target line, searched within a
 * small window of the hinted line number. If `anchorContent` repeats, the
 * `occurrence` index disambiguates; the candidate must still land inside the
 * window. Anything that can't be uniquely placed is dropped.
 */
export function resolveComments(
  language: Language,
  source: string,
  raw: RawComment[],
): ResolveResult {
  const lines = source.split('\n');
  const prefix = language === 'python' ? '# ' : '// ';
  const insertions: LineInsertion[] = [];
  let dropped = 0;

  for (const rc of raw) {
    const matches: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i] ?? '').trim() === rc.anchorContent) matches.push(i);
    }
    if (matches.length === 0) {
      dropped++;
      continue;
    }

    // Pick the target: the `occurrence`-th match if that lands in the window,
    // otherwise the match closest to the hinted line.
    const hint = rc.line - 1;
    let target = matches[Math.min(rc.occurrence - 1, matches.length - 1)] ?? matches[0]!;
    if (Math.abs(target - hint) > ANCHOR_WINDOW) {
      let closest = matches[0]!;
      for (const m of matches) {
        if (Math.abs(m - hint) < Math.abs(closest - hint)) closest = m;
      }
      target = closest;
    }
    if (Math.abs(target - hint) > ANCHOR_WINDOW) {
      dropped++;
      continue;
    }

    const indent = leadingWhitespace(lines[target] ?? '');
    const formatted = rc.comment.map((c) => `${indent}${prefix}${c}`);

    // Idempotency: if the line directly above is already this comment, skip.
    const above = lines[target - 1];
    if (above !== undefined && above.trim() === formatted[0]?.trim()) continue;

    insertions.push({ line: target + 1, lines: formatted });
  }
  return { insertions, dropped };
}
