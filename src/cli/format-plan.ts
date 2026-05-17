// src/cli/format-plan.ts
// Dry-run plan renderer for `refactron run --dry-run`. Opens with a titled
// `Dry run · …` heading, a bordered CHANGES overview table, then one diff
// section per file (path heading + a `│`-guttered colour diff), and ends with
// a bordered SUMMARY box — visually consistent with the `analyze` output.
//
// Returns RenderedLine[] so REPL (Ink) and one-shot CLI (stdout) can both
// render with their own color realization.

import * as path from 'node:path';
import Table from 'cli-table3';
import { generateUnifiedDiff, countChangedLines } from '../infrastructure/diff.js';
import { theme } from '../ui/theme.js';
import type { RefactorPlan, FileChange, TransformId } from '../contracts.js';
import { type RenderedLine, toPosix, clipPathLeft, tableChars } from './format-types.js';

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
  // Terminal width hint; defaults to process.stdout.columns, then 100.
  width?: number;
}

const INDENT = 2;

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

function colorForDiffLine(line: string): string {
  if (line.startsWith('+')) return theme.colors.success;
  if (line.startsWith('-')) return theme.colors.error;
  // `@@` hunk markers and unchanged context read as dim — the +/- lines pop.
  return theme.colors.textDim;
}

// Strip the trailing empty line that `createTwoFilesPatch` leaves on the diff
// string (its output always ends with `\n`).
function splitDiffLines(diff: string): string[] {
  const lines = diff.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

interface FileResult {
  rel: string;
  transforms: TransformId[];
  body: string[];
  added: number;
  removed: number;
}

export async function formatPlanAsDryRun(
  plan: RefactorPlan,
  originals: Map<string, string>,
  opts: FormatPlanOptions,
): Promise<RenderedLine[]> {
  const maxDiffLines = opts.maxDiffLines ?? 30;
  const diffContext = opts.diffContext ?? 3;
  const filesGlob = opts.filesGlob ?? null;
  const width = Math.max(60, Math.min(opts.width ?? process.stdout.columns ?? 100, 200));
  const out: RenderedLine[] = [];

  // 1) Filter by glob (operates on absolute path; glob is matched against
  //    relative-to-projectRoot AND basename for ergonomics). Normalize to
  //    forward slashes so a glob like `src/*.py` works on Windows too.
  let changes = plan.changes;
  if (filesGlob) {
    changes = changes.filter((c) => {
      const rel = toPosix(path.relative(opts.projectRoot, c.path));
      return matchesGlob(rel, filesGlob) || matchesGlob(toPosix(c.path), filesGlob);
    });
  }

  if (changes.length === 0) {
    out.push({ text: '' });
    out.push({ text: '  No changes to preview.', color: theme.colors.textDim });
    out.push({ text: '' });
    return out;
  }

  // 2) Pass one — build a per-file result and accumulate totals (the heading
  //    needs them before any section is emitted).
  const results: FileResult[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const group of groupByPath(changes)) {
    const original = originals.get(group.path) ?? '';
    const rel = toPosix(path.relative(opts.projectRoot, group.path) || group.path);
    const diff = generateUnifiedDiff(rel, original, group.finalContent, diffContext);
    const counts = countChangedLines(diff);
    totalAdded += counts.added;
    totalRemoved += counts.removed;
    // Drop the `====` / `--- a/` / `+++ b/` header block — the file path is
    // already a heading. Keep everything from the first `@@` hunk onward.
    const all = splitDiffLines(diff);
    const at = all.findIndex((l) => l.startsWith('@@'));
    results.push({
      rel,
      transforms: group.transforms,
      body: at >= 0 ? all.slice(at) : all,
      added: counts.added,
      removed: counts.removed,
    });
  }

  const emitTable = (heading: string, t: InstanceType<typeof Table>): void => {
    out.push({ text: `  ${heading}`, color: theme.colors.accent });
    for (const row of t.toString().split('\n')) {
      out.push({ text: `  ${row}`, color: theme.colors.border });
    }
    out.push({ text: '' });
  };

  // ── Heading ────────────────────────────────────────────────────────────────
  out.push({ text: '' });
  out.push({
    text: `  Dry run  ${theme.symbols.bullet}  ${results.length} file${
      results.length === 1 ? '' : 's'
    }  ${theme.symbols.bullet}  +${totalAdded} / -${totalRemoved}`,
    color: theme.colors.accent,
  });
  out.push({ text: '' });

  // ── CHANGES overview table — File · Transforms · Lines ─────────────────────
  const LINES_W = 15;
  const flex = width - INDENT - 4 - LINES_W; // 4 = 3-column frame
  let fileW = Math.min(34, Math.max(14, Math.round(flex * 0.45)));
  let transW = flex - fileW;
  if (transW < 14) {
    transW = 14;
    fileW = Math.max(10, flex - transW);
  }
  const cTable = new Table({
    head: ['File', 'Transforms', 'Lines'],
    colWidths: [fileW, transW, LINES_W],
    colAligns: ['left', 'left', 'right'],
    style: { head: [], border: [], 'padding-left': 1, 'padding-right': 1 },
    wordWrap: false,
    truncate: '…',
    chars: tableChars,
  });
  for (const r of results) {
    cTable.push([
      clipPathLeft(r.rel, fileW - 2),
      r.transforms.join(', '),
      `+${r.added} / -${r.removed}`,
    ]);
  }
  emitTable('CHANGES', cTable);

  // ── Per-file diff sections — one full 4-sided box per file ─────────────────
  // The box is drawn by hand (not cli-table3): cli-table3 colours the whole
  // table one colour, which would erase the green/red diff lines. Here every
  // line keeps its own colour, so the borders take that colour too. Diff lines
  // longer than the box are truncated with `…` to keep the right `│` aligned.
  const W = width - 6; // INDENT(2) + "│ "(2) + " │"(2)
  const fit = (s: string): string => (s.length > W ? `${s.slice(0, W - 1)}…` : s.padEnd(W));
  const boxTop = (): RenderedLine => ({
    text: `  ┌${'─'.repeat(W + 2)}┐`,
    color: theme.colors.border,
  });
  const boxBottom = (): RenderedLine => ({
    text: `  └${'─'.repeat(W + 2)}┘`,
    color: theme.colors.border,
  });
  const boxLine = (content: string, color: string): RenderedLine => ({
    text: `  │ ${fit(content)} │`,
    color,
  });

  for (const r of results) {
    out.push(boxTop());
    out.push(boxLine(clipPathLeft(r.rel, W), theme.colors.accent));
    out.push(
      boxLine(
        `${r.transforms.join(', ')}  ${theme.symbols.bullet}  +${r.added} / -${r.removed}`,
        theme.colors.textDim,
      ),
    );
    out.push(boxLine('', theme.colors.border));
    for (const line of r.body.slice(0, maxDiffLines)) {
      out.push(boxLine(line, colorForDiffLine(line)));
    }
    if (r.body.length > maxDiffLines) {
      const elided = r.body.length - maxDiffLines;
      out.push(
        boxLine(
          `… ${elided} more lines elided. Use --diff-context to see more.`,
          theme.colors.textDim,
        ),
      );
    }
    out.push(boxBottom());
    out.push({ text: '' });
  }

  // ── SUMMARY box — Metric · Value, no header row ────────────────────────────
  const sumRows: Array<[string, string]> = [
    ['Files', String(results.length)],
    ['Lines', `+${totalAdded} / -${totalRemoved}`],
  ];
  const METRIC_W = 11;
  const sTable = new Table({
    colWidths: [
      METRIC_W,
      Math.min(Math.max(...sumRows.map((r) => r[1].length)) + 2, width - INDENT - 3 - METRIC_W),
    ],
    colAligns: ['left', 'left'],
    style: { border: [], 'padding-left': 1, 'padding-right': 1 },
    wordWrap: false,
    truncate: '…',
    chars: tableChars,
  });
  for (const r of sumRows) sTable.push(r);
  emitTable('SUMMARY', sTable);

  out.push({
    text: '  Next: `run --apply` to verify (3 gates) and write atomically. Nothing has been written.',
    color: theme.colors.textDim,
  });

  return out;
}
