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
      const elapsedMs = Date.now() - t0;
      // execa's r.timedOut field is unreliable across Node versions when
      // reject:false is set (notably Node 18 leaves it undefined even after
      // a real timeout fire). Derive timedOut from observable wall-clock:
      // if the process was killed by a signal AND the elapsed time has
      // reached the configured timeout, the timeout fired.
      const timedOut =
        r.timedOut === true || (typeof r.signal === 'string' && elapsedMs >= spec.timeoutMs);
      last = {
        exitCode: r.exitCode ?? 1,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut,
        durationMs: elapsedMs,
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
