// src/cli/format-types.ts
// Shared rendered-line shape returned by the CLI formatters. A line carries
// its text and an optional color hint; the printer side (Ink, plain stdout,
// JSON) decides how to realize the color.

export interface RenderedLine {
  text: string;
  color?: string;
}

/** Normalize a path for terminal display so output is consistent across
 *  platforms. On Windows, `path.relative` produces backslash separators
 *  (`src\foo.py`); the formatters always render forward slashes (`src/foo.py`)
 *  to match the convention every other dev tool uses (git, pytest, vitest, …)
 *  and to keep test snapshots cross-platform. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}
