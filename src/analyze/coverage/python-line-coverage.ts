import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Canonical form for path keys in the covered-lines set: no leading `./`,
 *  forward slashes only. Both producer (this module) and consumer (any
 *  detector that looks up `${ctx.relPath}:${line}`) must apply this so the
 *  set lookup actually hits. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

export interface CoverageReportInput {
  projectRoot: string;
  testCmd?: string; // default: 'pytest -q'
  pythonBin?: string; // default: 'python3'
  _probeOverride?: boolean; // test-only injection point
}

export interface CoverageReport {
  coverageToolFound: boolean;
  coveredLines: Set<string>; // `${relPath}:${line}` (1-indexed)
  // Every file coverage.py MEASURED, whether or not any line ran. A changed
  // file missing from this set was never loaded by the suite at all, which is a
  // different claim from "its lines did not execute" and must not be reported
  // as one: the usual cause is the tests importing an installed copy of the
  // package instead of the tree under verification.
  measuredFiles: Set<string>;
  runDurationMs: number;
  // True when coverage.py exists but the measurement could not be performed
  // (unwrappable command, failed run, no data emitted). Callers MUST treat this
  // as "unknown coverage", never as "nothing is covered": claiming zero
  // coverage we never measured is a lie about the user's test suite.
  measurementFailed: boolean;
  measurementFailureReason?: string;
}

// Shell metacharacters mean the command is a composite the coverage wrapper
// cannot reliably wrap (`pytest && lint`, pipes, substitutions). Guessing here
// risks measuring only part of the suite, so we decline and report unknown.
const SHELL_COMPOSITE_RE = /&&|\|\||[;|`<>]|\$\(/;

/** How to hand `testCmd` to `coverage run`. Module form needs `-m`; a script
 *  path must be passed positionally, or coverage tries to import a module by
 *  that name (Django's `python3 tests/runtests.py` failed exactly this way). */
/** Split a command into argv, honoring single and double quotes. The tests gate
 *  hands the command to a shell, where `-k "not slow"` is ONE argument; a plain
 *  whitespace split would pass `"not` and `slow"` and silently change which
 *  tests run, so the measured coverage would not match the verified run. */
function tokenizeCommand(cmd: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of cmd.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur || started) out.push(cur);
      cur = '';
      started = false;
      continue;
    }
    cur += ch;
  }
  if (cur || started) out.push(cur);
  return out;
}

export function toCoverageRunArgs(testCmd: string): string[] | null {
  if (SHELL_COMPOSITE_RE.test(testCmd)) return null;
  const tokens = tokenizeCommand(testCmd);
  if (tokens.length === 0) return null;

  // Drop a leading interpreter: `python3 -m pytest` and `python3 script.py`
  // both describe what to run, not how to spawn it.
  let rest = tokens;
  if (/^python[0-9.]*$/.test(tokens[0] ?? '')) rest = tokens.slice(1);
  if (rest.length === 0) return null;

  const head = rest[0] ?? '';
  if (head === '-m') {
    const mod = rest.slice(1);
    return mod.length > 0 ? ['-m', ...mod] : null;
  }
  // A script path (ends in .py, or is a path) runs positionally; anything else
  // is a console entry point we invoke as a module (pytest, vitest).
  if (head.endsWith('.py') || head.includes('/') || head.includes('\\')) return [...rest];
  return ['-m', ...rest];
}

/** Probe whether `coverage.py` can actually RUN in the user's Python.
 *  `-m coverage --version`, not `-c "import coverage"`: a directory literally
 *  named `coverage/` on sys.path (a vitest/jest HTML coverage OUTPUT dir in
 *  the cwd is the common case) imports fine as a namespace package with
 *  `__file__ = None`, but cannot be executed as a module. Probing execution
 *  in `cwd` keeps the probe honest in the same context as the real run. */
function probeCoverage(pythonBin: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(pythonBin, ['-m', 'coverage', '--version'], { stdio: 'ignore', cwd });
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

/** Run a command in `cwd` with `env` and resolve to its exit code + stderr.
 *  Returns null exit code on spawn error. */
function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    p.stdout.on('data', () => {
      /* drop */
    });
    p.on('exit', (code) => resolve({ code, stderr }));
    p.on('error', () => resolve({ code: null, stderr }));
  });
}

export async function reportCoverage(input: CoverageReportInput): Promise<CoverageReport> {
  const t0 = performance.now();
  const pythonBin = input.pythonBin ?? 'python3';
  const testCmd = input.testCmd ?? 'pytest -q';

  const found = input._probeOverride ?? (await probeCoverage(pythonBin, input.projectRoot));
  if (!found) {
    return {
      coverageToolFound: false,
      coveredLines: new Set(),
      measuredFiles: new Set(),
      runDurationMs: 0,
      measurementFailed: false,
    };
  }

  const cmdArgs = toCoverageRunArgs(testCmd);
  if (cmdArgs === null) {
    return {
      coverageToolFound: true,
      coveredLines: new Set(),
      measuredFiles: new Set(),
      runDurationMs: performance.now() - t0,
      measurementFailed: true,
      measurementFailureReason: `cannot wrap test command for coverage: ${testCmd}`,
    };
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-cov-'));
  const dataFile = path.join(tmp, '.coverage');
  const jsonFile = path.join(tmp, 'coverage.json');
  const env = { ...process.env, COVERAGE_FILE: dataFile };

  const covered = new Set<string>();
  const measured = new Set<string>();
  let failureReason: string | undefined;
  try {
    // 1) Run tests under coverage. A nonzero exit here is NOT itself a failure
    // (a red suite still produces valid coverage data); what matters is whether
    // a data file was written at all. A command coverage could not launch
    // leaves nothing behind, and that must read as unknown, not zero.
    const runArgs = ['-m', 'coverage', 'run', '--data-file', dataFile, ...cmdArgs];
    const run = await runCmd(pythonBin, runArgs, input.projectRoot, env);
    const wroteData = await fs
      .access(dataFile)
      .then(() => true)
      .catch(() => false);
    if (!wroteData) {
      failureReason =
        run.code === null
          ? `coverage run could not be spawned: ${run.stderr.trim().slice(0, 200)}`
          : `coverage run produced no data (exit ${run.code}): ${run.stderr.trim().slice(0, 200)}`;
    }

    // 2) Emit JSON. --ignore-errors: a suite that runs exec(compile(src,
    // "string", "exec")) leaves a measured "file" with no source on disk, and
    // without the flag `coverage json` exits non-zero and writes NOTHING,
    // silently zeroing coverage for every real file. Phantom entries are
    // dropped; real files keep their data.
    const emit = await runCmd(
      pythonBin,
      ['-m', 'coverage', 'json', '--ignore-errors', '--data-file', dataFile, '-o', jsonFile],
      input.projectRoot,
      env,
    );
    if (failureReason === undefined && emit.code !== 0) {
      // Data exists but we could not turn it into a report. Reporting an empty
      // covered set here would be the same lie as a failed run: unknown, not zero.
      failureReason = `coverage json failed (exit ${emit.code ?? 'null'}): ${emit.stderr.trim().slice(0, 200)}`;
    }

    // 3) Parse.
    try {
      const raw = await fs.readFile(jsonFile, 'utf8');
      const parsed = JSON.parse(raw) as { files?: Record<string, { executed_lines?: number[] }> };
      for (const [relPath, fileData] of Object.entries(parsed.files ?? {})) {
        // Normalize the path: strip a leading `./` and force forward slashes
        // so keys match whatever convention the detector emits for its own
        // relPath. Without this, coverage.json's `flask_appbuilder/foo.py`
        // never matches a detector lookup of `./flask_appbuilder/foo.py:42`.
        const normalized = normalizePath(relPath);
        measured.add(normalized);
        for (const line of fileData.executed_lines ?? []) {
          covered.add(`${normalized}:${line}`);
        }
      }
    } catch {
      // JSON missing or unparseable. We have no measurement, so say so rather
      // than returning an empty covered set that reads as "nothing is covered".
      if (failureReason === undefined) {
        failureReason = 'coverage report could not be read';
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }

  return {
    coverageToolFound: true,
    coveredLines: covered,
    measuredFiles: measured,
    runDurationMs: performance.now() - t0,
    measurementFailed: failureReason !== undefined,
    ...(failureReason !== undefined ? { measurementFailureReason: failureReason } : {}),
  };
}
