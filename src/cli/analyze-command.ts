import * as fs from 'node:fs/promises';
import { RefactronAnalyzer } from '../analyze/engine.js';
import { formatAnalysisReport } from './format-analysis.js';
import { toJson } from '../analyze/format/json.js';
import type { Confidence } from '../analyze/detectors/types.js';
import { requireAuth } from './auth-gate.js';
import { applyColor } from './apply-color.js';
import { loadRefactronConfig } from './config-loader.js';

interface ParsedFlags {
  target: string;
  json: boolean;
  confidence: Confidence | null;
  graphPath: string | null;
  failOn: Confidence | null;
}

const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function asConfidence(v: string | undefined): Confidence | null {
  return v && (CONFIDENCES as string[]).includes(v) ? (v as Confidence) : null;
}

export class AnalyzeFlagError extends Error {}

export function parseFlags(argv: string[]): ParsedFlags {
  let target: string | null = null;
  let json = false;
  let confidence: Confidence | null = null;
  let graphPath: string | null = null;
  let failOn: Confidence | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') {
      json = true;
      continue;
    }
    if (a === '--confidence') {
      const c = asConfidence(argv[++i]);
      if (!c) throw new AnalyzeFlagError(`--confidence requires one of: ${CONFIDENCES.join(', ')}`);
      confidence = c;
      continue;
    }
    if (a.startsWith('--confidence=')) {
      const c = asConfidence(a.slice('--confidence='.length));
      if (!c) throw new AnalyzeFlagError(`--confidence requires one of: ${CONFIDENCES.join(', ')}`);
      confidence = c;
      continue;
    }
    if (a === '--fail-on') {
      const c = asConfidence(argv[++i]);
      if (!c) throw new AnalyzeFlagError(`--fail-on requires one of: ${CONFIDENCES.join(', ')}`);
      failOn = c;
      continue;
    }
    if (a.startsWith('--fail-on=')) {
      const c = asConfidence(a.slice('--fail-on='.length));
      if (!c) throw new AnalyzeFlagError(`--fail-on requires one of: ${CONFIDENCES.join(', ')}`);
      failOn = c;
      continue;
    }
    if (a.startsWith('--graph=')) {
      graphPath = a.slice('--graph='.length);
      continue;
    }
    if (a.startsWith('-')) {
      throw new AnalyzeFlagError(`unknown flag: ${a}`);
    }
    if (target !== null) {
      throw new AnalyzeFlagError(
        `unexpected extra argument: ${a} (target already set to "${target}")`,
      );
    }
    target = a;
  }
  return { target: target ?? '.', json, confidence, graphPath, failOn };
}

export async function runAnalyzeCommand(argv: string[]): Promise<number> {
  const authResult = await requireAuth('analyze');
  if (authResult !== true) return authResult;
  let flags: ParsedFlags;
  try {
    flags = parseFlags(argv);
  } catch (err) {
    if (err instanceof AnalyzeFlagError) {
      process.stderr.write(`refactron analyze: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
  let confidence: Confidence;
  let excludeGlobs: string[] = [];
  try {
    const config = await loadRefactronConfig(flags.target);
    confidence = flags.confidence ?? config.confidence;
    excludeGlobs = config.exclude;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`refactron analyze: ${msg}\n`);
    return 2;
  }
  const analyzerOpts: { confidence: Confidence; excludeGlobs?: string[] } = { confidence };
  if (excludeGlobs.length > 0) analyzerOpts.excludeGlobs = excludeGlobs;
  const analyzer = new RefactronAnalyzer(analyzerOpts);
  const report = await analyzer.analyzeExtended(flags.target);
  if (flags.graphPath) {
    await fs.writeFile(flags.graphPath, toJson(report), 'utf8');
  }
  if (flags.json) {
    process.stdout.write(toJson(report) + '\n');
  } else {
    const lines = await formatAnalysisReport(report, { projectRoot: flags.target });
    for (const line of lines) {
      process.stdout.write(applyColor(line.text, line.color) + '\n');
    }
  }
  if (flags.failOn) {
    const threshold = CONFIDENCE_RANK[flags.failOn];
    const offending = report.findings.filter((f) => CONFIDENCE_RANK[f.confidence] >= threshold);
    if (offending.length > 0) {
      process.stderr.write(
        `refactron analyze: --fail-on ${flags.failOn} matched ${offending.length} finding(s)\n`,
      );
      return 1;
    }
  }
  return 0;
}
