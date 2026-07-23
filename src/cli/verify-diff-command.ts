// src/cli/verify-diff-command.ts
// `refactron verify-diff [repoRoot] --diff <file>` — verify an arbitrary diff
// and print the SAFE/UNSAFE/UNPROVEN verdict. The local primitive under the MCP tool.
import * as fs from 'node:fs/promises';
import { verifyDiff } from '../verify/verify-diff.js';
import { requireAuth } from './auth-gate.js';
import { applyColor } from './apply-color.js';

export class VerifyDiffFlagError extends Error {}

interface VerifyDiffFlags {
  repoRoot: string;
  diffPath: string | null;
  json: boolean;
  testCmd: string | null;
}

export function parseVerifyDiffFlags(argv: string[]): VerifyDiffFlags {
  let repoRoot: string | null = null;
  let diffPath: string | null = null;
  let json = false;
  let testCmd: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') {
      json = true;
      continue;
    }
    if (a === '--diff') {
      diffPath = argv[++i] ?? null;
      if (!diffPath) throw new VerifyDiffFlagError('--diff requires a file path');
      continue;
    }
    if (a.startsWith('--diff=')) {
      diffPath = a.slice('--diff='.length);
      if (!diffPath) throw new VerifyDiffFlagError('--diff requires a file path');
      continue;
    }
    if (a === '--test-cmd') {
      testCmd = argv[++i] ?? null;
      if (!testCmd) throw new VerifyDiffFlagError('--test-cmd requires a command');
      continue;
    }
    if (a.startsWith('--test-cmd=')) {
      testCmd = a.slice('--test-cmd='.length);
      if (!testCmd) throw new VerifyDiffFlagError('--test-cmd requires a command');
      continue;
    }
    if (a.startsWith('-')) throw new VerifyDiffFlagError(`unknown flag: ${a}`);
    if (repoRoot !== null) throw new VerifyDiffFlagError(`unexpected extra argument: ${a}`);
    repoRoot = a;
  }
  return { repoRoot: repoRoot ?? '.', diffPath, json, testCmd };
}

const VERDICT_COLOR: Record<string, string> = {
  SAFE: '#3fb950', // success
  UNSAFE: '#f85149', // error
  UNPROVEN: '#d29922', // warning
};

// One-line advisory when a diff touches test files. Not a verdict change — a
// heads-up that the diff could be weakening its own safety net. Returns null
// when nothing test-shaped changed. Previews the first three paths.
export function formatTestFilesNote(testFilesChanged: string[]): string | null {
  if (testFilesChanged.length === 0) return null;
  const preview = testFilesChanged.slice(0, 3).join(', ');
  const suffix = testFilesChanged.length > 3 ? ', ...' : '';
  return `note: this diff modifies test files (${testFilesChanged.length}): ${preview}${suffix}`;
}

// One-line advisory when tests failed once then passed on the gate's same-shadow
// retry. Those were treated as flaky (not the diff's fault) and did not change
// the verdict; the note keeps that decision visible. Returns null when none.
export function formatFlakyNote(flakyTests: string[]): string | null {
  if (flakyTests.length === 0) return null;
  const preview = flakyTests.slice(0, 3).join(', ');
  const suffix = flakyTests.length > 3 ? ', ...' : '';
  return `note: ${flakyTests.length} test(s) flipped on retry and were treated as flaky: ${preview}${suffix}`;
}

export async function runVerifyDiffCommand(argv: string[]): Promise<number> {
  const authResult = await requireAuth('verify-diff');
  if (authResult !== true) return authResult;

  let flags: VerifyDiffFlags;
  try {
    flags = parseVerifyDiffFlags(argv);
  } catch (err) {
    if (err instanceof VerifyDiffFlagError) {
      process.stderr.write(`refactron verify-diff: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
  if (!flags.diffPath) {
    process.stderr.write('refactron verify-diff: --diff <file> is required\n');
    return 2;
  }

  let report;
  try {
    const unifiedDiff = await fs.readFile(flags.diffPath, 'utf8');
    report = await verifyDiff({
      repoRoot: flags.repoRoot,
      unifiedDiff,
      ...(flags.testCmd ? { testCmd: flags.testCmd } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`refactron verify-diff: ${msg}\n`);
    return 2;
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(
      applyColor(`[${report.verdict}] ${report.reason}`, VERDICT_COLOR[report.verdict]) + '\n',
    );
    for (const u of report.coverage.uncovered) {
      process.stdout.write(`  uncovered: ${u.file}:${u.line}\n`);
    }
    const note = formatTestFilesNote(report.testFilesChanged);
    if (note) process.stdout.write(note + '\n');
    const flakyNote = formatFlakyNote(report.flakyTests ?? []);
    if (flakyNote) process.stdout.write(flakyNote + '\n');
  }
  return report.verdict === 'UNSAFE' ? 1 : 0;
}
