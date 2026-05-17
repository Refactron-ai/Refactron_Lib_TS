// src/document/line-edits.ts
// Pure line-level insertion. The single splice path shared by docstring and
// inline-comment application — so the two can never disagree on line math.

export interface LineInsertion {
  /** 1-indexed line number to insert ABOVE. */
  line: number;
  /** Fully-formatted lines to insert (no trailing newline). */
  lines: string[];
}

/**
 * Insert whole lines into `source`. Insertions are applied highest-line-first,
 * so an earlier insertion never shifts the anchor of a later one — the caller
 * may pass insertions in any order.
 */
export function applyLineInsertions(source: string, insertions: LineInsertion[]): string {
  if (insertions.length === 0) return source;
  const lines = source.split('\n');
  const sorted = [...insertions].sort((a, b) => b.line - a.line);
  for (const ins of sorted) {
    if (ins.lines.length === 0) continue;
    const idx = Math.max(0, Math.min(ins.line - 1, lines.length));
    lines.splice(idx, 0, ...ins.lines);
  }
  return lines.join('\n');
}
