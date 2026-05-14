import { describe, it, expect } from 'vitest';
import { runRunner } from '../../../src/verify/runners/run.js';

describe('runRunner', () => {
  it('returns exit code 0 on success', async () => {
    const r = await runRunner({
      cmd: 'sh',
      args: ['-c', 'exit 0'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    expect(r.exitCode).toBe(0);
  });
  it('returns nonzero on failure', async () => {
    const r = await runRunner({
      cmd: 'sh',
      args: ['-c', 'exit 17'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    expect(r.exitCode).toBe(17);
  });
  // Per-test timeout 15s: this test deliberately exercises execa's timeout +
  // SIGKILL + cleanup wall-clock, which on a contended CI runner can exceed
  // vitest's default 5000ms long after the runner has reported timedOut=true.
  it('reports timeout', async () => {
    const r = await runRunner({
      cmd: 'sh',
      args: ['-c', 'sleep 5'],
      cwd: process.cwd(),
      timeoutMs: 500,
    });
    expect(r.timedOut).toBe(true);
  }, 15_000);
  it('retries baseline on flake', async () => {
    let attempt = 0;
    const r = await runRunner(
      { cmd: 'sh', args: ['-c', 'exit 0'], cwd: process.cwd(), timeoutMs: 5_000 },
      { retries: 2, onAttempt: () => attempt++ },
    );
    expect(r.exitCode).toBe(0);
    expect(attempt).toBeGreaterThanOrEqual(1);
  });
});
