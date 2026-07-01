// src/cli/preflight-command.ts
// `refactron preflight [target]` — coverage-aware migration safety report for
// the SQLAlchemy 1.x -> 2.0 query-to-select migration. Detect + coverage +
// verdict only (no rewriter: G0 returned STOP on the auto-rewrite premise).
import { RefactronAnalyzer } from '../analyze/engine.js';
import { buildSafetyReport } from '../analyze/safety/verdict.js';
import { formatSafetyReport, safetyReportToJson } from './format-safety.js';
import { requireAuth } from './auth-gate.js';
import { applyColor } from './apply-color.js';
import { loadRefactronConfig } from './config-loader.js';
import type { TransformId } from '../contracts.js';

// Not in the locked TransformId union (Phase 1 ships no rewriter, so it stays
// out). Carried through the engine via cast, matching the detector itself.
const SQLALCHEMY_TRANSFORM = 'sqlalchemy_query_to_select';

export class PreflightFlagError extends Error {}

interface PreflightFlags {
  target: string;
  json: boolean;
  failOnUnproven: boolean;
}

export function parsePreflightFlags(argv: string[]): PreflightFlags {
  let target: string | null = null;
  let json = false;
  let failOnUnproven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') {
      json = true;
      continue;
    }
    if (a === '--fail-on-unproven') {
      failOnUnproven = true;
      continue;
    }
    if (a.startsWith('-')) {
      throw new PreflightFlagError(`unknown flag: ${a}`);
    }
    if (target !== null) {
      throw new PreflightFlagError(
        `unexpected extra argument: ${a} (target already set to "${target}")`,
      );
    }
    target = a;
  }
  return { target: target ?? '.', json, failOnUnproven };
}

export async function runPreflightCommand(argv: string[]): Promise<number> {
  const authResult = await requireAuth('preflight');
  if (authResult !== true) return authResult;

  let flags: PreflightFlags;
  try {
    flags = parsePreflightFlags(argv);
  } catch (err) {
    if (err instanceof PreflightFlagError) {
      process.stderr.write(`refactron preflight: ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  let excludeGlobs: string[] = [];
  try {
    const config = await loadRefactronConfig(flags.target);
    excludeGlobs = config.exclude;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`refactron preflight: ${msg}\n`);
    return 2;
  }

  // confidence MUST be 'medium' — the SQLAlchemy detector emits at 'medium' and
  // the engine drops anything below the requested level ('high' default would
  // discard every finding). Passing the transforms list (with the sqlalchemy
  // id) is what makes the engine run the coverage reporter.
  const analyzerOpts: {
    confidence: 'medium';
    excludeGlobs?: string[];
    transforms: TransformId[];
  } = {
    confidence: 'medium',
    transforms: [SQLALCHEMY_TRANSFORM] as unknown as TransformId[],
  };
  if (excludeGlobs.length > 0) analyzerOpts.excludeGlobs = excludeGlobs;

  const analyzer = new RefactronAnalyzer(analyzerOpts);
  const report = await analyzer.analyzeExtended(flags.target);
  const sqlFindings = report.findings.filter(
    (f) => (f.transformId as string) === SQLALCHEMY_TRANSFORM,
  );
  const safety = buildSafetyReport(flags.target, SQLALCHEMY_TRANSFORM, sqlFindings);

  if (flags.json) {
    process.stdout.write(safetyReportToJson(safety) + '\n');
  } else {
    for (const line of formatSafetyReport(safety)) {
      process.stdout.write(applyColor(line.text, line.color) + '\n');
    }
  }

  if (flags.failOnUnproven && safety.counts.unproven > 0) {
    process.stderr.write(
      `refactron preflight: --fail-on-unproven matched ${safety.counts.unproven} unproven site(s)\n`,
    );
    return 1;
  }
  return 0;
}
