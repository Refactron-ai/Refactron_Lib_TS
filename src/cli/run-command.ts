// src/cli/run-command.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RefactronAnalyzer } from '../analyze/engine.js';
import { RefactronRefactorer } from '../transform/engine.js';
import { RefactronVerifier } from '../verify/engine.js';
import { writeBatchAtomic } from '../verify/atomic-batch-writer.js';
import { generateUnifiedDiff } from '../infrastructure/diff.js';
import type { Confidence } from '../analyze/detectors/types.js';
import type { TransformId } from '../contracts.js';
import { requireAuth } from './auth-gate.js';
import { loadRefactronConfig } from './config-loader.js';
import { persistLastApply } from './last-apply.js';
import { scopePlanChanges } from './runner.js';
import { formatGateProgress, formatVerifySuccess, formatVerifyFailure } from './format-verify.js';
import { applyColor } from './apply-color.js';

// Markers that identify a project root. Walked up from a file argument to find
// the right directory to hand to the analyzer/refactorer/verifier.
const PROJECT_ROOT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  '.refactronrc.json',
  '.refactronrc',
  'refactron.config.js',
];

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(start: string): Promise<string> {
  let dir = start;
  // Walk up until we hit one of the markers or the filesystem root.
  // Falls back to `start` itself if nothing matches.
  for (;;) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await pathExists(path.join(dir, marker))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

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
  transforms: TransformId[] | null;
  confidence: Confidence | null;
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
  let transforms: TransformId[] | null = null;
  let confidence: Confidence | null = null;
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

  // Resolve target → (projectRoot, optional scopedPath). When the user passes
  // a FILE, the engine still needs a directory to act as the project root, so
  // we walk up for a marker (.git / package.json / pyproject.toml / .refactronrc).
  // The file itself becomes the scope filter on the resulting plan.
  let projectRoot: string;
  let scopedPath: string | null = null;
  let scopedIsFile = false;
  {
    const absTarget = path.resolve(flags.target);
    let stat;
    try {
      stat = await fs.stat(absTarget);
    } catch {
      process.stderr.write(`refactron run: no such path: ${flags.target}\n`);
      return 2;
    }
    if (stat.isFile()) {
      projectRoot = await findProjectRoot(path.dirname(absTarget));
      scopedPath = absTarget;
      scopedIsFile = true;
    } else {
      projectRoot = absTarget;
    }
  }

  // Load .refactronrc — flags override config values entirely (no merging of arrays).
  let confidence: Confidence;
  let transforms: TransformId[];
  let testCmd: string | null;
  try {
    const config = await loadRefactronConfig(projectRoot);
    confidence = flags.confidence ?? config.confidence;
    testCmd = flags.testCmd ?? config.testCmd;
    if (flags.transforms !== null) {
      transforms = flags.transforms;
    } else if (config.transforms.includes('all')) {
      transforms = [...TRANSFORM_IDS];
    } else {
      // schema validated; all entries are valid TransformId strings (no 'all')
      transforms = config.transforms as TransformId[];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`refactron run: ${msg}\n`);
    return 2;
  }

  const analyzer = new RefactronAnalyzer({ confidence });
  const report = await analyzer.analyzeExtended(projectRoot);

  const refactorer = new RefactronRefactorer({ projectRoot });
  const plan = await refactorer.plan(report, transforms);

  if (scopedPath !== null) {
    plan.changes = scopePlanChanges(plan.changes, scopedPath, scopedIsFile);
  }

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
  // Capture pre-write originals so the `document` command can rebuild a diff
  // context after the verifier's atomic writes hit disk. Missing/unreadable
  // files are simply skipped — documentation will produce nothing for them.
  const originalsBeforeWrite = new Map<string, string>();
  for (const change of plan.changes) {
    try {
      originalsBeforeWrite.set(change.path, await fs.readFile(change.path, 'utf8'));
    } catch {
      // best-effort
    }
  }

  let capturedShadowRoot: string | null = null;
  const verifierOpts: {
    projectRoot: string;
    testCmd?: string;
    onGateComplete: (
      gate: 'syntax' | 'imports' | 'tests',
      g: import('../contracts.js').GateResult,
    ) => void;
    onShadowRoot: (p: string) => void;
  } = {
    projectRoot,
    onGateComplete: (gate, g) => {
      for (const line of formatGateProgress(gate, g)) {
        process.stdout.write(applyColor(line.text, line.color) + '\n');
      }
    },
    onShadowRoot: (p) => {
      capturedShadowRoot = p;
    },
  };
  if (testCmd) verifierOpts.testCmd = testCmd;
  const verifier = new RefactronVerifier(verifierOpts);
  const result = await verifier.verify(plan);
  if (!result.passed) {
    for (const line of formatVerifyFailure(result, plan, projectRoot, capturedShadowRoot)) {
      process.stderr.write(applyColor(line.text, line.color) + '\n');
    }
    return 1;
  }
  await writeBatchAtomic(result.writableChanges);
  await persistLastApply({
    projectRoot,
    verifiedAt: new Date().toISOString(),
    changes: result.writableChanges.map((c) => ({
      path: c.path,
      oldContent: originalsBeforeWrite.get(c.path) ?? '',
      newContent: c.newContent,
      transformId: c.transformId,
    })),
  });
  for (const line of formatVerifySuccess(result, plan, projectRoot)) {
    process.stdout.write(applyColor(line.text, line.color) + '\n');
  }
  return 0;
}
