import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

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

/** Probe whether `coverage.py` is importable in the user's Python. */
function probeCoverage(pythonBin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(pythonBin, ['-c', 'import coverage'], { stdio: 'ignore' });
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

  const found = input._probeOverride ?? (await probeCoverage(pythonBin));
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

    // 2) Emit JSON.
    await runCmd(
      pythonBin,
      ['-m', 'coverage', 'json', '--data-file', dataFile, '-o', jsonFile],
      input.projectRoot,
      env,
    );

    // 3) Parse.
    try {
      const raw = await fs.readFile(jsonFile, 'utf8');
      const parsed = JSON.parse(raw) as { files?: Record<string, { executed_lines?: number[] }> };
      for (const [relPath, fileData] of Object.entries(parsed.files ?? {})) {
        for (const line of fileData.executed_lines ?? []) {
          covered.add(`${relPath}:${line}`);
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
