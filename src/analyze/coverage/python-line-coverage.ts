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
  // Every EXECUTABLE line per file (`executed_lines` UNION `missing_lines`),
  // keyed by the same normalized relative path as `coveredLines`. coverage.py
  // attributes a statement's execution to its FIRST line only: continuation
  // lines, closing brackets, blanks and comments are in NEITHER list. A consumer
  // asking "is this physical line covered?" therefore reports every line a
  // formatter wrapped as uncovered. This set is what lets a consumer map a
  // changed line back to the statement that actually ran.
  executableLines: Map<string, Set<number>>;
  // Lines coverage.py EXCLUDED from judgement (`# pragma: no cover`, and in most
  // projects `if TYPE_CHECKING:`). Reported separately from `executableLines`
  // because an excluded statement can never be exercised by ANY test: a consumer
  // that reports it as uncovered must say so differently, instead of asking the
  // user for a test that cannot exist. Note the exclusion is a PHYSICAL RANGE,
  // not a set of statement starts: measured on coverage 7.11, a pragma'd `def`
  // whose body spans 6..11 reports excluded_lines [5,6,7,8,9,10,11].
  excludedLines: Map<string, Set<number>>;
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

/** A leading `NAME=VALUE` token, as a shell would read it. The name must be a
 *  valid shell identifier, so `--opt=1` and `-k` are flags rather than
 *  assignments, and an empty value is legal (`FOO= cmd` unsets FOO). */
const ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/** What to hand `coverage run`, plus any environment the command carried.
 *  The env is separate because `coverage run` takes argv, not a shell line. */
export interface CoverageRunPlan {
  args: string[];
  env: Record<string, string>;
}

export function toCoverageRunArgs(testCmd: string): CoverageRunPlan | null {
  if (SHELL_COMPOSITE_RE.test(testCmd)) return null;
  const tokens = tokenizeCommand(testCmd);
  if (tokens.length === 0) return null;

  // Hoist a leading run of `NAME=VALUE` assignments. The tests gate runs the
  // command through `sh -c`, where these are environment assignments; this
  // runner spawns argv directly, so without hoisting `PYTHONPATH=.` was
  // classified as a MODULE NAME below and `coverage run -m PYTHONPATH=.` wrote
  // no data file at all. That silently capped every project following our own
  // shadow-bypass advice at UNPROVEN. Stop at the first non-assignment, so a
  // real argument that merely contains `=` (`pytest -k a=b`) is never eaten.
  const env: Record<string, string> = {};
  let i = 0;
  for (; i < tokens.length; i++) {
    const m = ASSIGNMENT_RE.exec(tokens[i] ?? '');
    if (!m) break;
    const value = m[2] as string;
    // `PYTHONPATH=$HOME/x` is expanded by the shell the tests gate runs under,
    // and would be passed through literally here. The two runs would then see
    // different paths, so the coverage numbers would describe a run that was
    // never verified. Decline instead: unknown is honest, a mismatch is not.
    // (Backticks and `$(` are already refused by SHELL_COMPOSITE_RE above.)
    if (value.includes('$')) return null;
    env[m[1] as string] = value;
  }
  const afterEnv = tokens.slice(i);
  if (afterEnv.length === 0) return null;

  // Drop a leading interpreter: `python3 -m pytest` and `python3 script.py`
  // both describe what to run, not how to spawn it.
  let rest = afterEnv;
  if (/^python[0-9.]*$/.test(afterEnv[0] ?? '')) rest = afterEnv.slice(1);
  if (rest.length === 0) return null;

  const head = rest[0] ?? '';
  if (head === '-m') {
    const mod = rest.slice(1);
    return mod.length > 0 ? { args: ['-m', ...mod], env } : null;
  }
  // A script path (ends in .py, or is a path) runs positionally; anything else
  // is a console entry point we invoke as a module (pytest, vitest).
  if (head.endsWith('.py') || head.includes('/') || head.includes('\\')) {
    return { args: [...rest], env };
  }
  return { args: ['-m', ...rest], env };
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
      executableLines: new Map(),
      excludedLines: new Map(),
      runDurationMs: 0,
      measurementFailed: false,
    };
  }

  const plan = toCoverageRunArgs(testCmd);
  if (plan === null) {
    return {
      coverageToolFound: true,
      coveredLines: new Set(),
      measuredFiles: new Set(),
      executableLines: new Map(),
      excludedLines: new Map(),
      runDurationMs: performance.now() - t0,
      measurementFailed: true,
      measurementFailureReason: `cannot wrap test command for coverage: ${testCmd}`,
    };
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-cov-'));
  const dataFile = path.join(tmp, '.coverage');
  const jsonFile = path.join(tmp, 'coverage.json');
  // Order is deliberate. The command's own assignments override the inherited
  // environment, which is the point of writing them; COVERAGE_FILE goes last
  // so a test command can never redirect the data file we are about to read,
  // which would look exactly like "coverage measured nothing".
  const env = { ...process.env, ...plan.env, COVERAGE_FILE: dataFile };

  const covered = new Set<string>();
  const measured = new Set<string>();
  const executable = new Map<string, Set<number>>();
  const excludedByFile = new Map<string, Set<number>>();
  let failureReason: string | undefined;
  try {
    // 1) Run tests under coverage. A nonzero exit here is NOT itself a failure
    // (a red suite still produces valid coverage data); what matters is whether
    // a data file was written at all. A command coverage could not launch
    // leaves nothing behind, and that must read as unknown, not zero.
    const runArgs = ['-m', 'coverage', 'run', '--data-file', dataFile, ...plan.args];
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
      const parsed = JSON.parse(raw) as {
        files?: Record<
          string,
          { executed_lines?: number[]; missing_lines?: number[]; excluded_lines?: number[] }
        >;
      };
      for (const [relPath, fileData] of Object.entries(parsed.files ?? {})) {
        // Normalize the path: strip a leading `./` and force forward slashes
        // so keys match whatever convention the detector emits for its own
        // relPath. Without this, coverage.json's `flask_appbuilder/foo.py`
        // never matches a detector lookup of `./flask_appbuilder/foo.py:42`.
        const normalized = normalizePath(relPath);
        measured.add(normalized);
        // executed UNION missing UNION excluded. The first two are the statement
        // starts coverage.py judged; the third is the one that bites. A statement
        // matched by `exclude_lines` (`# pragma: no cover`, and in most projects
        // `if TYPE_CHECKING:`) is dropped from BOTH judged lists, so an executable
        // set built from executed+missing alone has a HOLE where that code lives.
        // A consumer resolving a changed line to its enclosing statement would
        // then walk backwards through the hole and land on whatever covered
        // statement precedes it, reporting provably-unexecuted code as covered.
        // Excluded lines are still code, so they belong in the executable set:
        // they are never in `coveredLines`, so anything attributed to them stays
        // honestly unproven.
        const stmts = executable.get(normalized) ?? new Set<number>();
        for (const line of fileData.executed_lines ?? []) {
          covered.add(`${normalized}:${line}`);
          stmts.add(line);
        }
        for (const line of fileData.missing_lines ?? []) {
          stmts.add(line);
        }
        const skipped = excludedByFile.get(normalized) ?? new Set<number>();
        for (const line of fileData.excluded_lines ?? []) {
          stmts.add(line);
          skipped.add(line);
        }
        executable.set(normalized, stmts);
        excludedByFile.set(normalized, skipped);
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
    executableLines: executable,
    excludedLines: excludedByFile,
    runDurationMs: performance.now() - t0,
    measurementFailed: failureReason !== undefined,
    ...(failureReason !== undefined ? { measurementFailureReason: failureReason } : {}),
  };
}
