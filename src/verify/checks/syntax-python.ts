import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { GateResult } from '../../contracts.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/syntax_check.py',
);

export async function checkPythonSyntax(files: string[]): Promise<GateResult> {
  const t0 = Date.now();
  if (files.length === 0) {
    return { passed: true, durationMs: 0 };
  }
  try {
    await execa('python3', [SIDECAR, ...files], { reject: true, timeout: 30_000 });
    return { passed: true, durationMs: Date.now() - t0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    const reason = (e.stdout ?? '').trim() || (e.stderr ?? '').trim() || e.message;
    return { passed: false, durationMs: Date.now() - t0, blockingReason: reason };
  }
}
