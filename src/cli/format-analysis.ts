// src/cli/format-analysis.ts
// Analyze-command formatter. Renders one bordered box per file (Line · Severity
// · Transform · Code, one row per finding), followed by three more bordered
// boxes — TRANSFORMS (guidance), BY TRANSFORM (counts), SUMMARY. Returns
// RenderedLine[] so the REPL (Ink) and the one-shot CLI (stdout) render it
// identically.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Table from 'cli-table3';
import type { ExtendedAnalysisReport } from '../analyze/engine.js';
import type { DetectorFinding, Confidence } from '../analyze/detectors/types.js';
import type { TransformId } from '../contracts.js';
import { SUGGESTION_BY_TRANSFORM, TIER_BY_TRANSFORM, type TransformTier } from './v2-adapters.js';
import { theme } from '../ui/theme.js';
import { type RenderedLine, toPosix, clipPathLeft, tableChars } from './format-types.js';

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

  // ── Tallies ───────────────────────────────────────────────────────────────
  const distinctTransforms = [...new Set(report.findings.map((f) => f.transformId))];
  const byTransform = new Map<TransformId, number>();
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byTier: Record<TransformTier, number> = { debt: 0, modernization: 0, style: 0 };
  const minutesByTier: Record<TransformTier, number> = { debt: 0, modernization: 0, style: 0 };
  for (const f of report.findings) {
    byTransform.set(f.transformId, (byTransform.get(f.transformId) ?? 0) + 1);
    bySeverity[confidenceToSeverity(f.confidence)]++;
    const tier = TIER_BY_TRANSFORM[f.transformId];
    byTier[tier]++;
    minutesByTier[tier] += f.remediationMinutes;
  }
  const total = report.findings.length;

  // Shared id-column width — TRANSFORMS and BY TRANSFORM align on it. The cap
  // keeps the guidance column ≥ MIN_GUIDANCE (and so BY TRANSFORM fits too).
  const MIN_GUIDANCE = 22;
  const rawIdW = Math.max(9, ...distinctTransforms.map((t) => t.length)) + 2;
  const idColW = Math.min(rawIdW, width - INDENT - 3 - MIN_GUIDANCE);

  const section = (heading: string, t: InstanceType<typeof Table>): void => {
    out.push({ text: `  ${heading}`, color: theme.colors.accent });
    for (const row of t.toString().split('\n')) {
      out.push({ text: `  ${row}`, color: theme.colors.border });
    }
    out.push({ text: '' });
  };

  // ── TRANSFORMS — Transform · What it does ─────────────────────────────────
  const tTable = new Table({
    head: ['Transform', 'What it does'],
    colWidths: [idColW, width - INDENT - 3 - idColW],
    colAligns: ['left', 'left'],
    style: { head: [], border: [], 'padding-left': 1, 'padding-right': 1 },
    wordWrap: false,
    truncate: '…',
    chars: tableChars,
  });
  for (const tid of distinctTransforms) {
    tTable.push([tid, SUGGESTION_BY_TRANSFORM[tid as TransformId] ?? '']);
  }
  section('TRANSFORMS', tTable);

  // ── BY TIER — Tier · Count · Minutes, debt first ─────────────────────────
  // The tier label classifies a finding by the strength of the case for fixing
  // it: `debt` (real maintenance burden with a forward-looking argument),
  // `modernization` (newer form is clearly better), `style` (semantically
  // identical, pure preference). Surfaces the long-tail style noise separately
  // from the actually-urgent items.
  const tierTable = new Table({
    head: ['Tier', 'Count', 'Minutes'],
    colWidths: [idColW, 9, 11],
    colAligns: ['left', 'right', 'right'],
    style: { head: [], border: [], 'padding-left': 1, 'padding-right': 1 },
    wordWrap: false,
    truncate: '…',
    chars: tableChars,
  });
  for (const tier of ['debt', 'modernization', 'style'] as const) {
    tierTable.push([tier, String(byTier[tier]), String(minutesByTier[tier])]);
  }
  section('BY TIER', tierTable);

  // ── BY TRANSFORM — Transform · Count, most-frequent first ─────────────────
  const btTable = new Table({
    head: ['Transform', 'Count'],
    colWidths: [idColW, 9],
    colAligns: ['left', 'right'],
    style: { head: [], border: [], 'padding-left': 1, 'padding-right': 1 },
    wordWrap: false,
    truncate: '…',
    chars: tableChars,
  });
  for (const [tid, n] of [...byTransform.entries()].sort((a, b) => b[1] - a[1])) {
    btTable.push([tid, String(n)]);
  }
  section('BY TRANSFORM', btTable);

  // ── SUMMARY — Metric · Value, no header row ───────────────────────────────
  const sevLine = `${bySeverity.critical} critical  ${theme.symbols.bullet}  ${bySeverity.high} high  ${theme.symbols.bullet}  ${bySeverity.medium} medium  ${theme.symbols.bullet}  ${bySeverity.low} low`;
  // `analyze` only DETECTS — it never runs a transform, so it cannot promise a
  // finding will produce a change (a transform may hit a precondition and skip
  // safely). Report findings as auto-fix *candidates* and defer the real count
  // to `run --dry-run`, rather than the misleading "N / N" that read as a
  // guarantee every finding would be fixed.
  const tierLine =
    `${byTier.debt} debt  ${theme.symbols.bullet}  ` +
    `${byTier.modernization} modernization  ${theme.symbols.bullet}  ` +
    `${byTier.style} style`;
  const summaryRows: Array<[string, string]> = [
    ['Files affected', String(groups.size)],
    ['By severity', sevLine],
    ['By tier', tierLine],
    ['Auto-fixable', `${total} candidate(s) — \`run --dry-run\` shows real changes`],
  ];
  const METRIC_W = 18;
  const sTable = new Table({
    colWidths: [
      METRIC_W,
      Math.min(Math.max(...summaryRows.map((r) => r[1].length)) + 2, width - INDENT - 3 - METRIC_W),
    ],
    colAligns: ['left', 'left'],
    style: { border: [], 'padding-left': 1, 'padding-right': 1 },
    wordWrap: false,
    truncate: '…',
    chars: tableChars,
  });
  for (const r of summaryRows) sTable.push(r);
  section('SUMMARY', sTable);

  // Guarantee no emitted line exceeds the terminal width. Table lines already
  // fit exactly by construction; this only ever clips the legend / summary
  // prose, which would otherwise wrap.
  return out.map((l) =>
    l.text.length > width ? { ...l, text: `${l.text.slice(0, width - 1)}…` } : l,
  );
}
