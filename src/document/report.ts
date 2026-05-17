// src/document/report.ts
// The per-run modernization report — docs/refactron/modernization-<date>.md.
//
// The markdown scaffold, diff snippets, and line stats are DETERMINISTIC
// (built from the apply snapshot). The LLM contributes prose only — a run
// summary and a per-file "why it is safe" note — so the report can never
// contain a hallucinated diff.

import * as path from 'node:path';
import type { VerificationResult } from '../contracts.js';
import { generateUnifiedDiff, countChangedLines } from '../infrastructure/diff.js';
import type { ReportFileInput } from './prompts.js';

/** First ~30 body lines of a unified diff — enough context, bounded size. */
function diffExcerpt(diff: string): string {
  return diff
    .split('\n')
    .filter((l) => !l.startsWith('+++') && !l.startsWith('---') && !l.startsWith('==='))
    .slice(0, 30)
    .join('\n');
}

export interface ReportFile {
  relPath: string;
  transformId: string;
  added: number;
  removed: number;
  diff: string;
}

export interface ReportModel {
  files: ReportFile[];
}

/** Build the deterministic report model from the verified changes. */
export function buildReportModel(
  verified: VerificationResult,
  originals: Map<string, string>,
  projectRoot: string,
): ReportModel {
  const files: ReportFile[] = [];
  for (const change of verified.writableChanges) {
    const oldText = originals.get(change.path);
    if (oldText === undefined) continue;
    const relPath = path.relative(projectRoot, change.path) || change.path;
    const diff = generateUnifiedDiff(relPath, oldText, change.newContent);
    const counts = countChangedLines(diff);
    files.push({
      relPath,
      transformId: change.transformId,
      added: counts.added,
      removed: counts.removed,
      diff: diffExcerpt(diff),
    });
  }
  return { files };
}

/** Inputs for the prose LLM call, derived from the model. */
export function reportProseInputs(model: ReportModel): ReportFileInput[] {
  return model.files.map((f) => ({
    relPath: f.relPath,
    transformId: f.transformId as ReportFileInput['transformId'],
    diffExcerpt: f.diff,
  }));
}

export interface ReportProse {
  summary: string;
  files: Record<string, string>;
}

/** Parse the strict-JSON `{summary, files}` the report prompt asks for. */
export function parseReportProse(raw: string): ReportProse {
  const text = raw
    .trim()
    .replace(/^```[A-Za-z0-9_-]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const o = parsed as Record<string, unknown>;
      const summary = typeof o.summary === 'string' ? o.summary : '';
      const files: Record<string, string> = {};
      if (typeof o.files === 'object' && o.files !== null) {
        for (const [k, v] of Object.entries(o.files as Record<string, unknown>)) {
          if (typeof v === 'string') files[k] = v;
        }
      }
      return { summary, files };
    }
  } catch {
    // fall through
  }
  return { summary: '', files: {} };
}

export interface ReportRecheck {
  ok: boolean;
  rolledBack: string[];
}

/** Render the full modernization report markdown. Pure. */
export function renderModernizationReport(
  model: ReportModel,
  prose: ReportProse,
  recheck: ReportRecheck,
  date: string,
): string {
  const transforms = [...new Set(model.files.map((f) => f.transformId))];
  const recheckLine = recheck.ok
    ? 'passed'
    : `rolled back: ${recheck.rolledBack.join(', ') || 'unknown'}`;

  const out: string[] = [];
  out.push(`# Refactron Modernization Report — ${date}`, '');
  out.push('## Summary', '');
  out.push(prose.summary.trim() || 'A deterministic, behaviour-preserving modernization run.', '');
  out.push(`- Files changed: ${model.files.length}`);
  out.push(`- Transforms: ${transforms.join(', ')}`);
  out.push('- Pre-write verification: syntax, imports, tests — passed');
  out.push(`- Post-apply syntax re-check: ${recheckLine}`, '');

  out.push('## Per-file changes', '');
  for (const f of model.files) {
    out.push(`### ${f.relPath} — ${f.transformId}`, '');
    out.push(`\`+${f.added} / -${f.removed}\` lines.`, '');
    const why = prose.files[f.relPath];
    if (why && why.trim() !== '') out.push(why.trim(), '');
    out.push('```diff', f.diff.trimEnd(), '```', '');
  }

  out.push('## Verification', '');
  out.push('- Pre-write gates (`run --apply`): syntax · imports · tests — all passed.');
  out.push(`- Post-apply syntax re-check: ${recheckLine}.`);
  if (!recheck.ok && recheck.rolledBack.length > 0) {
    out.push('');
    out.push('Files whose generated documentation failed the re-check were rolled back:');
    for (const f of recheck.rolledBack) out.push(`- ${f}`);
  }
  return out.join('\n') + '\n';
}

/** Absolute path of the report file for a given run date. */
export function reportPath(changelogDir: string, date: string): string {
  return path.join(changelogDir, 'docs', 'refactron', `modernization-${date}.md`);
}
