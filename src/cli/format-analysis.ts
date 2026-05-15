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

// Minimum widths for the three flexible columns. Their sum (35) plus the
// fixed line/severity columns, the frame, and the row indent is exactly 60 —
// the narrowest terminal we render to without wrapping.
const COL_MIN = { file: 11, transform: 10, code: 14 } as const;

/**
 * Distribute `flex` columns across FILE / TRANSFORM / CODE so the table fits.
 * Starts at preferred widths, shrinks the widest column still above its
 * minimum until the total fits, and hands any leftover budget to CODE so the
 * table fills the terminal. Returns [fileW, transformW, codeW].
 */
function fitColumns(flex: number): [number, number, number] {
  let fileW = 32;
  let transformW = 25;
  let codeW = Math.max(COL_MIN.code, flex - fileW - transformW);
  let guard = 4000;
  while (fileW + transformW + codeW > flex && guard-- > 0) {
    const candidates: Array<[number, 'file' | 'transform' | 'code']> = [];
    if (fileW > COL_MIN.file) candidates.push([fileW, 'file']);
    if (transformW > COL_MIN.transform) candidates.push([transformW, 'transform']);
    if (codeW > COL_MIN.code) candidates.push([codeW, 'code']);
    if (candidates.length === 0) break; // all at minimum — accept graceful overflow
    candidates.sort((a, b) => b[0] - a[0]);
    const target = candidates[0]?.[1];
    if (target === 'file') fileW--;
    else if (target === 'transform') transformW--;
    else codeW--;
  }
  return [fileW, transformW, codeW];
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
  // The rendered line is `INDENT + sum(colWidths) + FRAME`. colWidths are
  // padding-inclusive; the 5-column frame is 6 chars. Budget every part so
  // the line never exceeds `width` — otherwise the terminal wraps it and the
  // box-drawing shatters.
  const INDENT = 2;
  const FRAME = 6;
  const LINE_W = 7;
  const SEV_W = 10;
  const width = Math.max(60, Math.min(opts.width ?? process.stdout.columns ?? 100, 200));
  const flex = width - INDENT - FRAME - LINE_W - SEV_W;
  const [FILE_W, TRANSFORM_W, CODE_W] = fitColumns(flex);

  const table = new Table({
    head: ['File', 'Line', 'Severity', 'Transform', 'Code'],
    colWidths: [FILE_W, LINE_W, SEV_W, TRANSFORM_W, CODE_W],
    colAligns: ['left', 'right', 'left', 'left', 'left'],
    // Disable cli-table3's own ANSI colouring — RenderedLine carries one
    // colour per line and the printers own the tinting.
    style: { head: [], border: [], 'padding-left': 1, 'padding-right': 1 },
    wordWrap: false, // long code/paths truncate with `truncate` rather than wrap
    truncate: '…',
    // Outer frame + a single rule under the header; no rule between data
    // rows — a horizontal line per finding is exactly the noise we removed.
    chars: {
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
    },
  });

  // One row per finding, grouped by file (file shown once, blank on repeats).
  for (const [file, fileFindings] of groups) {
    const sourceLines = await cache.get(file);
    const filePosix = toPosix(file);

    fileFindings.forEach((finding, idx) => {
      const sev = confidenceToSeverity(finding.confidence);
      const raw = sourceLines ? (sourceLines[finding.line - 1] ?? '').trim() : '';
      const code = raw.length > 0 ? raw : '(no source)';
      table.push([
        idx === 0 ? clipPathLeft(filePosix, FILE_W - 2) : '',
        String(finding.line),
        sev,
        finding.transformId,
        code,
      ]);
    });
  }

  // Heading first — this is the first non-empty line, so the REPL's `⏺`
  // first-output indicator lands here and not on the table's top border.
  const findingCount = report.findings.length;
  out.push({ text: '' });
  out.push({
    text: `  Analysis  ${theme.symbols.bullet}  ${findingCount} finding${
      findingCount === 1 ? '' : 's'
    }`,
    color: theme.colors.accent,
  });
  out.push({ text: '' });
  for (const row of table.toString().split('\n')) {
    out.push({ text: `  ${row}`, color: theme.colors.border });
  }

  // ── Transforms legend ─────────────────────────────────────────────────────
  const distinctTransforms = [...new Set(report.findings.map((f) => f.transformId))];
  out.push({ text: '' });
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
