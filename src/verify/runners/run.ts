import { execa } from 'execa';
import type { RunnerSpec } from '../types.js';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface RunOptions {
  retries?: number;
  onAttempt?: (attempt: number) => void;
}

export async function runRunner(spec: RunnerSpec, opts: RunOptions = {}): Promise<RunResult> {
  const retries = Math.max(0, opts.retries ?? 0);
  let last: RunResult | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    opts.onAttempt?.(attempt);
    const t0 = Date.now();
    try {
      const r = await execa(spec.cmd, spec.args, {
        cwd: spec.cwd,
        timeout: spec.timeoutMs,
        reject: false,
        env: { ...process.env, CI: '1' },
      });
      last = {
        exitCode: r.exitCode ?? 1,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut: r.timedOut === true,
        durationMs: Date.now() - t0,
      };
      if (last.exitCode === 0 && !last.timedOut) return last;
    } catch (err) {
      const e = err as {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
        timedOut?: boolean;
        message: string;
      };
      last = {
        exitCode: e.exitCode ?? 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message,
        timedOut: e.timedOut === true,
        durationMs: Date.now() - t0,
      };
    }
  }
  return last!;
}
