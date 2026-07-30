// src/verify/statement-map.ts
// Build the physical-line -> enclosing-statement map for a set of Python files
// by running the AST sidecar (checks/_py/statement_map.py). The map is what lets
// coverage-attribution tell a continuation line of a statement from a blank or
// comment line that merely follows it; see that module for why statement STARTS
// alone are not enough and what false SAFE they shipped.
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { normalizePath } from '../analyze/coverage/index.js';
import type { StatementRun } from './coverage-attribution.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'checks/_py/statement_map.py',
);

export class StatementMapError extends Error {}

export interface StatementMap {
  /** Ascending, non-overlapping runs per NORMALIZED relative path. A line in no
   *  run is inert. */
  runs: Map<string, StatementRun[]>;
  /** Files the sidecar could not analyze (syntax error, unreadable, tokenizer
   *  refusal), keyed the same way. A non-empty map means the caller must degrade
   *  the assessment to UNKNOWN coverage; it must NEVER fall back to treating the
   *  file as statement-free, which would make every changed line inert and hand
   *  the file a silent free pass. */
  errors: Map<string, string>;
}

interface SidecarOutput {
  files?: Record<string, Array<[number, number, number]>>;
  errors?: Record<string, string>;
}

/**
 * Analyze `relPaths` (relative to `root`) and return their containment maps.
 *
 * Paths go over stdin NUL-separated rather than on argv: a mass reformat can
 * touch hundreds of files, Windows caps a command line at 32767 characters, and
 * a NUL separator also survives the (legal) POSIX path containing a newline.
 *
 * Throws {@link StatementMapError} when the sidecar could not run or produced
 * output we cannot trust. Every throw must map to UNKNOWN coverage upstream.
 */
export async function buildStatementMap(
  root: string,
  relPaths: string[],
  pythonBin = 'python3',
): Promise<StatementMap> {
  const runs = new Map<string, StatementRun[]>();
  const errors = new Map<string, string>();
  if (relPaths.length === 0) return { runs, errors };

  // The sidecar echoes each path back verbatim, so absolute -> relative is a
  // straight lookup and no path arithmetic has to be repeated on the way out.
  const byAbsolute = new Map<string, string>();
  for (const rel of relPaths) byAbsolute.set(path.resolve(root, rel), rel);

  let stdout: string;
  try {
    const result = await execa(pythonBin, [SIDECAR], {
      input: [...byAbsolute.keys()].join('\0'),
      reject: false,
      timeout: 120_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.exitCode !== 0) {
      throw new StatementMapError(
        `statement_map.py failed (exit ${result.exitCode ?? 'null'}): ${result.stderr.trim().slice(0, 200)}`,
      );
    }
    stdout = result.stdout;
  } catch (err) {
    if (err instanceof StatementMapError) throw err;
    throw new StatementMapError(
      `statement_map.py could not run: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: SidecarOutput;
  try {
    parsed = JSON.parse(stdout) as SidecarOutput;
  } catch {
    throw new StatementMapError('statement_map.py produced unparseable output');
  }

  for (const [abs, entries] of Object.entries(parsed.files ?? {})) {
    const rel = byAbsolute.get(abs);
    if (rel === undefined) continue; // a path we never asked about
    runs.set(
      normalizePath(rel),
      entries.map(([first, last, owner]) => ({ first, last, owner })),
    );
  }
  for (const [abs, reason] of Object.entries(parsed.errors ?? {})) {
    const rel = byAbsolute.get(abs);
    if (rel === undefined) continue;
    errors.set(normalizePath(rel), reason);
  }
  // A file that came back in neither bucket is a contract violation, not an
  // empty file. Surface it as an error so the caller degrades to UNKNOWN.
  for (const rel of relPaths) {
    const key = normalizePath(rel);
    if (!runs.has(key) && !errors.has(key)) {
      errors.set(key, 'statement_map.py returned no result for this file');
    }
  }
  return { runs, errors };
}
