// src/cli/run-command.ts
import * as fs from 'node:fs/promises';
import { RefactronAnalyzer } from '../analyze/engine.js';
import { RefactronRefactorer } from '../transform/engine.js';
import { RefactronVerifier } from '../verify/engine.js';
import { writeBatchAtomic } from '../verify/atomic-batch-writer.js';
import { generateUnifiedDiff } from '../infrastructure/diff.js';
import type { Confidence } from '../analyze/detectors/types.js';
import type { TransformId } from '../contracts.js';
import { requireAuth } from './auth-gate.js';

const TRANSFORM_IDS: TransformId[] = [
  'callback_to_async_await',
  'format_to_fstring',
  'manual_typecheck_to_hints',
  'deprecated_api_requests_to_httpx',
  'class_to_dataclass',
  'var_to_const_let',
  'promise_chains_to_async',
  'implicit_any',
  'commonjs_to_esm',
  'promise_constructor_to_async',
];
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];

export class RunFlagError extends Error {}

export interface ParsedFlags {
  target: string;
  apply: boolean;
  dryRun: boolean;
  transforms: TransformId[];
  confidence: Confidence;
  testCmd: string | null;
  json: boolean;
}

function asConfidence(v: string | undefined): Confidence | null {
  return v && (CONFIDENCES as string[]).includes(v) ? (v as Confidence) : null;
}

function parseTransforms(v: string): TransformId[] {
  if (v === 'all') return [...TRANSFORM_IDS];
  const out: TransformId[] = [];
  for (const id of v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!(TRANSFORM_IDS as string[]).includes(id)) {
      throw new RunFlagError(`unknown transform: ${id}`);
    }
    out.push(id as TransformId);
  }
  if (out.length === 0) throw new RunFlagError('--transforms requires at least one id');
  return out;
}

export function parseFlags(argv: string[]): ParsedFlags {
  let target: string | null = null;
  let apply = false;
  let dryRun = false;
  let transforms: TransformId[] = [...TRANSFORM_IDS];
  let confidence: Confidence = 'high';
  let testCmd: string | null = null;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') {
      apply = true;
      continue;
    }
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (a === '--json') {
      json = true;
      continue;
    }
    if (a === '--transforms' || a.startsWith('--transforms=')) {
      const v = a.includes('=') ? a.slice('--transforms='.length) : argv[++i];
      if (!v) throw new RunFlagError('--transforms requires a value');
      transforms = parseTransforms(v);
      continue;
    }
    if (a === '--confidence' || a.startsWith('--confidence=')) {
      const v = a.includes('=') ? a.slice('--confidence='.length) : argv[++i];
      const c = asConfidence(v);
      if (!c) throw new RunFlagError(`--confidence requires one of: ${CONFIDENCES.join(', ')}`);
      confidence = c;
      continue;
    }
    if (a === '--test-cmd' || a.startsWith('--test-cmd=')) {
      const v = a.includes('=') ? a.slice('--test-cmd='.length) : argv[++i];
      if (!v) throw new RunFlagError('--test-cmd requires a value');
      testCmd = v;
      continue;
    }
    if (a.startsWith('-')) throw new RunFlagError(`unknown flag: ${a}`);
    if (target !== null) throw new RunFlagError(`unexpected extra argument: ${a}`);
    target = a;
  }

  if (apply && dryRun) throw new RunFlagError('--apply and --dry-run are mutually exclusive');
  return {
    target: target ?? '.',
    apply,
    dryRun: dryRun || !apply,
    transforms,
    confidence,
    testCmd,
    json,
  };
}

export async function runRunCommand(argv: string[]): Promise<number> {
  const authResult = await requireAuth('run');
  if (authResult !== true) return authResult;
  let flags: ParsedFlags;
  try {
    flags = parseFlags(argv);
  } catch (err) {
    if (err instanceof RunFlagError) {
      process.stderr.write(`refactron run: ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const analyzer = new RefactronAnalyzer({ confidence: flags.confidence });
  const report = await analyzer.analyzeExtended(flags.target);

  const refactorer = new RefactronRefactorer({ projectRoot: flags.target });
  const plan = await refactorer.plan(report, flags.transforms);

  if (plan.changes.length === 0) {
    process.stdout.write('refactron run: no changes to apply\n');
    return 0;
  }

  if (flags.dryRun) {
    if (flags.json) {
      process.stdout.write(JSON.stringify({ mode: 'dry-run', plan }, null, 2) + '\n');
    } else {
      for (const c of plan.changes) {
        const original = await fs.readFile(c.path, 'utf8');
        process.stdout.write(generateUnifiedDiff(c.path, original, c.newContent) + '\n');
      }
      process.stdout.write(
        `refactron run --dry-run: ${plan.changes.length} file(s) would change\n`,
      );
    }
    return 0;
  }

  // --apply
  const verifierOpts: { projectRoot: string; testCmd?: string } = { projectRoot: flags.target };
  if (flags.testCmd) verifierOpts.testCmd = flags.testCmd;
  const verifier = new RefactronVerifier(verifierOpts);
  const result = await verifier.verify(plan);
  if (!result.passed) {
    const failed = Object.entries(result.gates).find(([, g]) => !g.passed);
    process.stderr.write(
      `refactron run: verification failed at gate '${failed?.[0] ?? 'unknown'}': ${failed?.[1].blockingReason ?? 'unknown'}\n`,
    );
    return 1;
  }
  await writeBatchAtomic(result.writableChanges);
  process.stdout.write(
    `refactron run: ${result.writableChanges.length} file(s) refactored and verified\n`,
  );
  return 0;
}
