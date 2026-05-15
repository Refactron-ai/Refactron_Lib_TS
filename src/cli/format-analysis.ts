// src/cli/format-analysis.ts
// Analyze-command formatter. Renders findings as a proper bordered table —
// File · Line · Severity · Transform · Code — one row per finding. Returns
// RenderedLine[] so the REPL (Ink) and the one-shot CLI (stdout) render it
// identically. Per-transform guidance is a single legend after the table.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Table from 'cli-table3';
import type { ExtendedAnalysisReport } from '../analyze/engine.js';
import type { DetectorFinding, Confidence } from '../analyze/detectors/types.js';
import type { TransformId } from '../contracts.js';
import { SUGGESTION_BY_TRANSFORM } from './v2-adapters.js';
import { theme } from '../ui/theme.js';
import { type RenderedLine, toPosix } from './format-types.js';

export interface FormatAnalysisOptions {
  projectRoot: string;
  /** Terminal width hint; defaults to process.stdout.columns, then 100. */
  width?: number;
}

type Severity = 'critical' | 'high' | 'medium' | 'low';

function confidenceToSeverity(c: Confidence): Severity {
  if (c === 'high') return 'high';
  if (c === 'medium') return 'medium';
  return 'low';
}

function splitLines(source: string): string[] {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Lazy per-file source cache. `null` = read failed, don't retry.
class SourceCache {
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly projectRoot: string) {}

  async get(relFile: string): Promise<string[] | null> {
    const cached = this.cache.get(relFile);
    if (cached !== undefined) return cached;
    try {
      const abs = path.resolve(this.projectRoot, relFile);
      const lines = splitLines(await fs.readFile(abs, 'utf8'));
      this.cache.set(relFile, lines);
      return lines;
    } catch {
      this.cache.set(relFile, null);
      return null;
    }
  }
}

function groupByFile(findings: DetectorFinding[]): Map<string, DetectorFinding[]> {
  const out = new Map<string, DetectorFinding[]>();
  for (const f of findings) {
    const bucket = out.get(f.file);
    if (bucket) bucket.push(f);
    else out.set(f.file, [f]);
  }
  // Source order within each file — matches a top-to-bottom read of the file.
  for (const bucket of out.values()) bucket.sort((a, b) => a.line - b.line);
  return out;
}

/** Truncate a path from the LEFT so the filename tail survives. */
function clipPathLeft(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - (max - 1))}`;
}

// Minimum widths for the two flexible columns. Their sum (28) plus the fixed
// line/severity columns, the 4-column frame, and the row indent is 52 — well
// inside the 60-column floor we render to without wrapping.
const COL_MIN = { transform: 12, code: 16 } as const;

/**
 * Distribute `flex` columns across TRANSFORM / CODE so the table fits. Starts
 * at preferred widths, shrinks the larger column still above its minimum until
 * the total fits, and hands any leftover budget to CODE so the table fills the
 * terminal. Returns [transformW, codeW].
 */
function fitColumns(flex: number): [number, number] {
  let transformW = 25;
  let codeW = Math.max(COL_MIN.code, flex - transformW);
  let guard = 4000;
  while (transformW + codeW > flex && guard-- > 0) {
    if (transformW <= COL_MIN.transform && codeW <= COL_MIN.code) break; // graceful overflow
    if (transformW > COL_MIN.transform && transformW >= codeW) transformW--;
    else if (codeW > COL_MIN.code) codeW--;
    else transformW--;
  }
  return [transformW, codeW];
}

export async function formatAnalysisReport(
  report: ExtendedAnalysisReport,
  opts: FormatAnalysisOptions,
): Promise<RenderedLine[]> {
  const out: RenderedLine[] = [];

  if (report.findings.length === 0) {
    out.push({ text: '  No findings.', color: theme.colors.success });
    return out;
  }

  const cache = new SourceCache(opts.projectRoot);
  const groups = groupByFile(report.findings);

  // ── Column widths, fitted to the terminal ─────────────────────────────────
  // Each per-file box's rendered line is `INDENT + sum(colWidths) + FRAME`.
  // colWidths are padding-inclusive; the 4-column frame is 5 chars. Budget
  // every part so the line never exceeds `width` — otherwise the terminal
  // wraps it and the box-drawing shatters. Widths are computed once and shared
  // by every per-file box so the boxes align vertically.
  const INDENT = 2;
  const FRAME = 5;
  const LINE_W = 7;
  const SEV_W = 10;
  const width = Math.max(60, Math.min(opts.width ?? process.stdout.columns ?? 100, 200));
  const flex = width - INDENT - FRAME - LINE_W - SEV_W;
  const [TRANSFORM_W, CODE_W] = fitColumns(flex);

  // Outer frame + verticals only — no rule under the header, no rule between
  // data rows. cli-table3 disables its own ANSI colouring (RenderedLine
  // carries one colour per line; the printers own the tinting).
  const tableChars = {
    top: '─',
    'top-mid': '┬',
    'top-left': '┌',
    'top-right': '┐',
    bottom: '─',
    'bottom-mid': '┴',
    'bottom-left': '└',
    'bottom-right': '┘',
    left: '│',
    right: '│',
    middle: '│',
    mid: '',
    'mid-mid': '',
    'left-mid': '',
    'right-mid': '',
  } as const;

  // Heading first — this is the first non-empty line, so the REPL's `⏺`
  // first-output indicator lands here and not on a table's top border.
  const findingCount = report.findings.length;
  out.push({ text: '' });
  out.push({
    text: `  Analysis  ${theme.symbols.bullet}  ${findingCount} finding${
      findingCount === 1 ? '' : 's'
    }`,
    color: theme.colors.accent,
  });
  out.push({ text: '' });

  // One bordered box per file — filename heading, then its own table, then a
  // blank line of breathing room before the next file.
  for (const [file, fileFindings] of groups) {
    const sourceLines = await cache.get(file);
    out.push({
      text: `  ${clipPathLeft(toPosix(file), width - INDENT)}`,
      color: theme.colors.accent,
    });

    const table = new Table({
      head: ['Line', 'Severity', 'Transform', 'Code'],
      colWidths: [LINE_W, SEV_W, TRANSFORM_W, CODE_W],
      colAligns: ['right', 'left', 'left', 'left'],
      style: { head: [], border: [], 'padding-left': 1, 'padding-right': 1 },
      wordWrap: false, // long code/ids truncate with `truncate` rather than wrap
      truncate: '…',
      chars: tableChars,
    });

    for (const finding of fileFindings) {
      const sev = confidenceToSeverity(finding.confidence);
      const raw = sourceLines ? (sourceLines[finding.line - 1] ?? '').trim() : '';
      table.push([
        String(finding.line),
        sev,
        finding.transformId,
        raw.length > 0 ? raw : '(no source)',
      ]);
    }

    for (const row of table.toString().split('\n')) {
      out.push({ text: `  ${row}`, color: theme.colors.border });
    }
    out.push({ text: '' });
  }

  // ── Transforms legend ─────────────────────────────────────────────────────
  const distinctTransforms = [...new Set(report.findings.map((f) => f.transformId))];
  out.push({ text: '  TRANSFORMS', color: theme.colors.accent });
  for (const tid of distinctTransforms) {
    const suggestion = SUGGESTION_BY_TRANSFORM[tid as TransformId] ?? '';
    out.push({
      text: `    ${tid.padEnd(TRANSFORM_W)}  ${suggestion}`,
      color: theme.colors.textDim,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const byTransform = new Map<TransformId, number>();
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of report.findings) {
    byTransform.set(f.transformId, (byTransform.get(f.transformId) ?? 0) + 1);
    bySeverity[confidenceToSeverity(f.confidence)]++;
  }
  const total = report.findings.length;
  const transformSummary = [...byTransform.entries()]
    .map(([tid, n]) => `${tid}: ${n}`)
    .join(`  ${theme.symbols.bullet}  `);

  out.push({ text: '' });
  out.push({ text: '  Summary', color: theme.colors.accent });
  out.push({ text: `    Files affected   ${groups.size}`, color: theme.colors.text });
  out.push({ text: `    By transform     ${transformSummary}`, color: theme.colors.text });
  out.push({
    text: `    By severity      ${bySeverity.critical} critical  ${theme.symbols.bullet}  ${bySeverity.high} high  ${theme.symbols.bullet}  ${bySeverity.medium} medium  ${theme.symbols.bullet}  ${bySeverity.low} low`,
    color: theme.colors.text,
  });
  out.push({ text: `    Fixable          ${total} / ${total}`, color: theme.colors.text });

  // Guarantee no emitted line exceeds the terminal width. Table lines already
  // fit exactly by construction; this only ever clips the legend / summary
  // prose, which would otherwise wrap.
  return out.map((l) =>
    l.text.length > width ? { ...l, text: `${l.text.slice(0, width - 1)}…` } : l,
  );
}
