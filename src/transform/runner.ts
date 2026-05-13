import { execa } from 'execa';
import type { Precondition } from '../contracts.js';

export type SidecarResult =
  | { ok: true; newContent: string; preconditions: Precondition[] }
  | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 60_000;

export async function runPythonTransform(
  sidecarPath: string,
  filePath: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SidecarResult> {
  try {
    const r = await execa('python3', [sidecarPath, filePath], {
      reject: false,
      timeout: timeoutMs,
    });
    if (r.timedOut) return { ok: false, error: `sidecar timed out after ${timeoutMs}ms` };
    try {
      const parsed = JSON.parse(r.stdout) as SidecarResult;
      return parsed;
    } catch {
      return {
        ok: false,
        error: `sidecar returned non-JSON output (exit ${r.exitCode}): ${r.stderr || r.stdout}`.slice(
          0,
          500,
        ),
      };
    }
  } catch (err) {
    const e = err as { message: string };
    return { ok: false, error: e.message };
  }
}
