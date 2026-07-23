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
  runDurationMs: number;
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
    return { coverageToolFound: false, coveredLines: new Set(), runDurationMs: 0 };
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-cov-'));
  const dataFile = path.join(tmp, '.coverage');
  const jsonFile = path.join(tmp, 'coverage.json');
  const env = { ...process.env, COVERAGE_FILE: dataFile };

  const covered = new Set<string>();
  try {
    // 1) Run tests under coverage.
    const runArgs = ['-m', 'coverage', 'run', '--data-file', dataFile, '-m', ...testCmd.split(' ')];
    await runCmd(pythonBin, runArgs, input.projectRoot, env);

    // 2) Emit JSON. --ignore-errors: a suite that runs exec(compile(src,
    // "string", "exec")) leaves a measured "file" with no source on disk, and
    // without the flag `coverage json` exits non-zero and writes NOTHING,
    // silently zeroing coverage for every real file. Phantom entries are
    // dropped; real files keep their data.
    await runCmd(
      pythonBin,
      ['-m', 'coverage', 'json', '--ignore-errors', '--data-file', dataFile, '-o', jsonFile],
      input.projectRoot,
      env,
    );

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
        for (const line of fileData.executed_lines ?? []) {
          covered.add(`${normalized}:${line}`);
        }
      }
    } catch {
      // JSON missing/unparseable → return empty but still mark tool as found.
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }

  return {
    coverageToolFound: true,
    coveredLines: covered,
    runDurationMs: performance.now() - t0,
  };
}
