// src/adapters/python/test-runner.ts
import { execa } from 'execa';
import type { CheckResult } from '../../core/models.js';
import path from 'path';

export async function runPytestForFile(
  filePath: string,
  _code: string,
): Promise<CheckResult> {
  const start = Date.now();
  const dir = path.dirname(filePath);

  try {
    await execa('python3', ['-m', 'pytest', dir, '-x', '-q', '--tb=short'], {
      timeout: 45_000,
      cwd: process.cwd(),
    });
    return { passed: true, durationMs: Date.now() - start };
  } catch (err) {
    const error = err as { stderr?: string; stdout?: string };
    const output = ((error.stderr ?? '') + (error.stdout ?? '')).slice(0, 500);
    return {
      passed: false,
      durationMs: Date.now() - start,
      blockingReason: output || 'pytest failed',
    };
  }
}
