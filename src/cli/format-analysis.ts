// src/cli/format-analysis.ts
// Analyze-command formatter. Groups findings by FILE (preserving the order
// they were emitted by the analyzer), pulls a small source excerpt around
// each finding's line, and renders the transform id + human message + the
// per-transform suggestion. Returns RenderedLine[] so the REPL (Ink) and the
// one-shot CLI (stdout) can choose how to realize the color hint.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExtendedAnalysisReport } from '../analyze/engine.js';
import type { DetectorFinding, Confidence } from '../analyze/detectors/types.js';
import type { TransformId } from '../contracts.js';
import { MESSAGE_BY_TRANSFORM, SUGGESTION_BY_TRANSFORM } from './v2-adapters.js';
import { theme } from '../ui/theme.js';
import { type RenderedLine, toPosix } from './format-types.js';

export interface FormatAnalysisOptions {
  projectRoot: string;
  excerptLinesBefore?: number; // default 1
  excerptLinesAfter?: number; // default 1
}

type Severity = 'critical' | 'high' | 'medium' | 'low';

const SEPARATOR = '─'.repeat(66);
const SUGGESTION_WRAP_COLS = 60;

function confidenceToSeverity(c: Confidence): Severity {
  if (c === 'high') return 'high';
  if (c === 'medium') return 'medium';
  return 'low';
}

function severityColor(s: Severity): string {
  return theme.severityColors[s];
}

// Word-wrap that preserves whole words. Returns at least one line.
function wrapWords(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur.length === 0) {
      cur = w;
    } else if (cur.length + 1 + w.length <= width) {
      cur = `${cur} ${w}`;
    } else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

// Splits a file's contents into 1-indexed lines. Tolerates both LF and CRLF;
// the trailing newline (if any) does not produce an extra empty line.
function splitLines(source: string): string[] {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Lazy per-file source cache. `null` = we tried and failed, don't retry.
class SourceCache {
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly projectRoot: string) {}

  async get(relFile: string): Promise<string[] | null> {
    const cached = this.cache.get(relFile);
    if (cached !== undefined) return cached;
    try {
      const abs = path.resolve(this.projectRoot, relFile);
      const source = await fs.readFile(abs, 'utf8');
      const lines = splitLines(source);
      this.cache.set(relFile, lines);
      return lines;
    } catch {
      this.cache.set(relFile, null);
      return null;
    }
  }
}

function excerptFor(
  lines: string[],
  targetLine: number,
  linesBefore: number,
  linesAfter: number,
): Array<{ lineNo: number; text: string; isTarget: boolean }> {
  const idx = targetLine - 1;
  const start = Math.max(0, idx - linesBefore);
  const end = Math.min(lines.length - 1, idx + linesAfter);
  const out: Array<{ lineNo: number; text: string; isTarget: boolean }> = [];
  for (let i = start; i <= end; i++) {
    out.push({ lineNo: i + 1, text: lines[i] ?? '', isTarget: i === idx });
  }
  return out;
}

function groupByFile(findings: DetectorFinding[]): Map<string, DetectorFinding[]> {
  const out = new Map<string, DetectorFinding[]>();
  for (const f of findings) {
    const bucket = out.get(f.file);
    if (bucket) {
      bucket.push(f);
    } else {
      out.set(f.file, [f]);
    }
  }
  // Sort each bucket by line so findings within a file render top-to-bottom
  // matching the source order. Without this, findings appear in detector-
  // emission order which is detector-by-detector — confusing on read-through.
  for (const bucket of out.values()) bucket.sort((a, b) => a.line - b.line);
  return out;
}

export async function formatAnalysisReport(
  report: ExtendedAnalysisReport,
  opts: FormatAnalysisOptions,
): Promise<RenderedLine[]> {
  const linesBefore = opts.excerptLinesBefore ?? 1;
  const linesAfter = opts.excerptLinesAfter ?? 1;
  const out: RenderedLine[] = [];

  if (report.findings.length === 0) {
    out.push({ text: '  No findings.', color: theme.colors.success });
    return out;
  }

  const cache = new SourceCache(opts.projectRoot);
  const groups = groupByFile(report.findings);

  for (const [file, fileFindings] of groups) {
    out.push({ text: '' });
    out.push({ text: SEPARATOR, color: theme.colors.border });
    const heading = `${toPosix(file)}  ${theme.symbols.bullet}  ${fileFindings.length} finding(s)`;
    out.push({ text: heading, color: theme.colors.accent });
    out.push({ text: SEPARATOR, color: theme.colors.border });
    out.push({ text: '' });

    const sourceLines = await cache.get(file);

    for (const finding of fileFindings) {
      const sev = confidenceToSeverity(finding.confidence);
      const sevLabel = sev.toUpperCase().padEnd(6); // 'HIGH  ', 'MEDIUM', 'LOW   '
      const message = MESSAGE_BY_TRANSFORM[finding.transformId as TransformId];
      const suggestion = SUGGESTION_BY_TRANSFORM[finding.transformId as TransformId];

      out.push({ text: `  ${sevLabel} ${message}`, color: severityColor(sev) });
      out.push({
        text: `         transform: ${finding.transformId}  ${theme.symbols.bullet}  line ${finding.line}`,
        color: theme.colors.textDim,
      });

      if (sourceLines === null) {
        out.push({ text: `           (source unavailable)`, color: theme.colors.textDim });
      } else {
        const excerpt = excerptFor(sourceLines, finding.line, linesBefore, linesAfter);
        for (const e of excerpt) {
          out.push({
            text: `           ${e.text}`,
            color: e.isTarget ? theme.colors.text : theme.colors.textDim,
          });
        }
      }

      const suggestionPrefix = '         suggestion: ';
      const continuationIndent = ' '.repeat(suggestionPrefix.length);
      const wrapped = wrapWords(suggestion, SUGGESTION_WRAP_COLS);
      const first = wrapped[0] ?? '';
      out.push({ text: `${suggestionPrefix}${first}`, color: theme.colors.textDim });
      for (let i = 1; i < wrapped.length; i++) {
        out.push({ text: `${continuationIndent}${wrapped[i] ?? ''}`, color: theme.colors.textDim });
      }
      out.push({ text: '' });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const filesAffected = groups.size;
  const byTransform = new Map<TransformId, number>();
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of report.findings) {
    byTransform.set(f.transformId, (byTransform.get(f.transformId) ?? 0) + 1);
    bySeverity[confidenceToSeverity(f.confidence)]++;
  }
  const total = report.findings.length;

  const transformParts: string[] = [];
  for (const [tid, n] of byTransform) transformParts.push(`${tid}: ${n}`);
  const transformSummary = transformParts.join(`  ${theme.symbols.bullet}  `);

  out.push({ text: 'Summary', color: theme.colors.accent });
  out.push({
    text: `  Files affected   ${filesAffected}`,
    color: theme.colors.text,
  });
  out.push({
    text: `  By transform     ${transformSummary}`,
    color: theme.colors.text,
  });
  out.push({
    text: `  By severity      ${bySeverity.critical} critical  ${theme.symbols.bullet}  ${bySeverity.high} high  ${theme.symbols.bullet}  ${bySeverity.medium} medium  ${theme.symbols.bullet}  ${bySeverity.low} low`,
    color: theme.colors.text,
  });
  out.push({
    text: `  Fixable          ${total} / ${total}`,
    color: theme.colors.text,
  });

  return out;
}
