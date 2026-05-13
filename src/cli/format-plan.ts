// src/cli/format-plan.ts
// Dry-run plan renderer for `refactron run --dry-run`. Groups planned changes
// by file (multiple transforms on one file fold into a single section), emits
// a unified diff per file with truncation, and ends with a Summary block.
//
// Returns RenderedLine[] so REPL (Ink) and one-shot CLI (stdout) can both
// render with their own color realization.

import * as path from 'node:path';
import { generateUnifiedDiff, countChangedLines } from '../infrastructure/diff.js';
import { theme } from '../ui/theme.js';
import type { RefactorPlan, FileChange, TransformId } from '../contracts.js';
import type { RenderedLine } from './format-types.js';

export interface FormatPlanOptions {
  projectRoot: string;
  // Cap on the number of diff body lines rendered per file. Excess lines are
  // replaced with a single "… N more lines elided" hint. Default 30.
  maxDiffLines?: number;
  // Unified-diff context window. Threaded into `generateUnifiedDiff` (which
  // forwards it to `diff.createTwoFilesPatch`'s `context` option). Default 3.
  diffContext?: number;
  // Optional glob to filter plan.changes. v1 supports `*` wildcards and basename
  // matching only (`*.py`, `src/*.ts`). Full glob support tracked for v2.1.
  filesGlob?: string | null;
}

const SEPARATOR = '─'.repeat(66);

interface FileGroup {
  path: string;
  transforms: TransformId[];
  // The newContent we render against the original. Multiple changes on the
  // same path are composed by the refactor engine before plan.changes is
  // built, so taking the LAST change's newContent gives the cumulative result.
  finalContent: string;
}

function groupByPath(changes: FileChange[]): FileGroup[] {
  const map = new Map<string, FileGroup>();
  const order: string[] = [];
  for (const c of changes) {
    const existing = map.get(c.path);
    if (existing) {
      if (!existing.transforms.includes(c.transformId)) {
        existing.transforms.push(c.transformId);
      }
      existing.finalContent = c.newContent;
    } else {
      map.set(c.path, {
        path: c.path,
        transforms: [c.transformId],
        finalContent: c.newContent,
      });
      order.push(c.path);
    }
  }
  return order.map((p) => map.get(p)!);
}

// Minimal glob: handles `*` (matches anything but path sep within a segment)
// and matches against either the full path or the basename. Tracked v2.1:
// proper minimatch-style support (negation, `**`, character classes).
function matchesGlob(filePath: string, pattern: string): boolean {
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$',
  );
  if (re.test(filePath)) return true;
  if (re.test(path.basename(filePath))) return true;
  return false;
}

function colorForDiffLine(line: string): string | undefined {
  // Header lines (`--- a/...`, `+++ b/...`) read as context.
  if (line.startsWith('+++') || line.startsWith('---')) return theme.colors.textDim;
  if (line.startsWith('+')) return theme.colors.success;
  if (line.startsWith('-')) return theme.colors.error;
  if (line.startsWith('@@')) return theme.colors.textDim;
  return theme.colors.text;
}

// Strip the trailing empty line that `createTwoFilesPatch` leaves on the diff
// string (its output always ends with `\n`).
function splitDiffLines(diff: string): string[] {
  const lines = diff.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export async function formatPlanAsDryRun(
  plan: RefactorPlan,
  originals: Map<string, string>,
  opts: FormatPlanOptions,
): Promise<RenderedLine[]> {
  const maxDiffLines = opts.maxDiffLines ?? 30;
  const diffContext = opts.diffContext ?? 3;
  const filesGlob = opts.filesGlob ?? null;
  const out: RenderedLine[] = [];

  // 1) Filter by glob (operates on absolute path; glob is matched against
  //    relative-to-projectRoot AND basename for ergonomics).
  let changes = plan.changes;
  if (filesGlob) {
    changes = changes.filter((c) => {
      const rel = path.relative(opts.projectRoot, c.path);
      return matchesGlob(rel, filesGlob) || matchesGlob(c.path, filesGlob);
    });
  }

  if (changes.length === 0) {
    out.push({ text: '' });
    out.push({ text: '  No changes to preview.', color: theme.colors.textDim });
    out.push({ text: '' });
    return out;
  }

  const groups = groupByPath(changes);
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const group of groups) {
    const original = originals.get(group.path) ?? '';
    const rel = path.relative(opts.projectRoot, group.path) || group.path;
    const diff = generateUnifiedDiff(rel, original, group.finalContent, diffContext);
    const counts = countChangedLines(diff);
    totalAdded += counts.added;
    totalRemoved += counts.removed;

    out.push({ text: '' });
    out.push({ text: SEPARATOR, color: theme.colors.border });
    out.push({ text: rel, color: theme.colors.accent });
    out.push({
      text: `  transforms: ${group.transforms.join(', ')}`,
      color: theme.colors.textDim,
    });
    out.push({
      text: `  +${counts.added} / -${counts.removed}`,
      color: theme.colors.text,
    });
    out.push({ text: SEPARATOR, color: theme.colors.border });

    const diffLines = splitDiffLines(diff);
    const shown = diffLines.slice(0, maxDiffLines);
    for (const line of shown) {
      const color = colorForDiffLine(line);
      const rendered: RenderedLine =
        color === undefined ? { text: `  ${line}` } : { text: `  ${line}`, color };
      out.push(rendered);
    }
    if (diffLines.length > maxDiffLines) {
      const elided = diffLines.length - maxDiffLines;
      out.push({
        text: `  … ${elided} more lines elided. Use --diff-context to see more.`,
        color: theme.colors.textDim,
      });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  out.push({ text: '' });
  out.push({ text: 'Summary', color: theme.colors.accent });
  out.push({ text: `  Files     ${groups.length}`, color: theme.colors.text });
  out.push({
    text: `  Lines     +${totalAdded} / -${totalRemoved}`,
    color: theme.colors.text,
  });
  out.push({ text: '' });
  out.push({
    text: 'Next: `run --apply` to verify (3 gates) and write atomically. Nothing has been written.',
    color: theme.colors.textDim,
  });

  return out;
}
