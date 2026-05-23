import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
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

/** Optional inputs for the source-based runner. */
export interface RunPythonTransformWithSourceOpts extends RunPythonTransformOpts {
  /** Project-relative path of the file the source came from. Mirrored under
   *  the per-call tmpdir so sidecars that derive `this_rel` via
   *  `relpath(argv[1], cross_file.projectRoot)` still see the same value. */
  relPath?: string;
  /** Optional cross-file context payload. Serialized to a tmpdir-local JSON
   *  with `projectRoot` rewritten to point at the per-call tmpdir, so the
   *  sidecar's `relpath(argv[1], projectRoot)` walks back to `relPath`. */
  crossFile?: unknown;
}

/**
 * Same as `runPythonTransform`, but takes the source text directly and writes
 * it to a per-call tmpfile that is passed to the sidecar in place of the real
 * file path. Required for transform composition: the engine threads each
 * transform's `newContent` forward via `ctx.source`, so a sidecar that re-reads
 * the original from disk would silently drop every prior transform's work
 * (last-transform-wins data loss).
 *
 * The sidecars themselves are unchanged — they keep reading from `argv[1]`,
 * which now points at this tmpfile holding the cumulative in-memory content.
 * When `crossFile` is supplied, its `projectRoot` is rewritten to the per-call
 * tmpdir and the tmpfile is placed at `tmpdir/<relPath>` so the sidecar's
 * `relpath(argv[1], projectRoot)` still resolves to the file's true relPath.
 *
 * Cleanup runs in `finally` so the tmpdir is always removed, even on sidecar
 * crash.
 */
export async function runPythonTransformWithSource(
  sidecarPath: string,
  source: string,
  opts: RunPythonTransformWithSourceOpts = {},
): Promise<SidecarResult> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-py-'));
  try {
    const fileName = opts.relPath ?? `f-${crypto.randomBytes(4).toString('hex')}.py`;
    const filePath = path.join(tmpRoot, fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source, 'utf8');

    // Forwarded sidecar options. Start from the caller's crossFilePath if any
    // (lets a caller still pre-render a JSON), then override if we serialize
    // a `crossFile` payload ourselves.
    const fwd: RunPythonTransformOpts = {};
    if (opts.timeoutMs !== undefined) fwd.timeoutMs = opts.timeoutMs;
    if (opts.crossFilePath !== undefined) fwd.crossFilePath = opts.crossFilePath;

    if (opts.crossFile !== undefined) {
      // Rewrite projectRoot so sidecars deriving this_rel via
      // relpath(argv[1], projectRoot) walk back to opts.relPath.
      const payload =
        typeof opts.crossFile === 'object' && opts.crossFile !== null
          ? { ...(opts.crossFile as Record<string, unknown>), projectRoot: tmpRoot }
          : { projectRoot: tmpRoot };
      const cfPath = path.join(tmpRoot, '__refactron_cf.json');
      await fs.writeFile(cfPath, JSON.stringify(payload), 'utf8');
      fwd.crossFilePath = cfPath;
    }

    return await runPythonTransform(sidecarPath, filePath, fwd);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}
