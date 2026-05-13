import { execa } from 'execa';
import type { Precondition } from '../contracts.js';

export type SidecarResult =
  | { ok: true; newContent: string; preconditions: Precondition[] }
  | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 60_000;

export interface RunPythonTransformOpts {
  timeoutMs?: number;
  // Path to a JSON file containing a serialized CrossFileContext. When set,
  // it is appended to the sidecar argv so `_cross_file.load_cross_file()` can read it.
  crossFilePath?: string;
}

export async function runPythonTransform(
  sidecarPath: string,
  filePath: string,
  opts: RunPythonTransformOpts = {},
): Promise<SidecarResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [sidecarPath, filePath];
  if (opts.crossFilePath) args.push(opts.crossFilePath);
  try {
    const r = await execa('python3', args, {
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
        error:
          `sidecar returned non-JSON output (exit ${r.exitCode}): ${r.stderr || r.stdout}`.slice(
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
