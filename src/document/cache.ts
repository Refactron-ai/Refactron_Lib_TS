/**
 * File-based response cache for documentation provider calls.
 *
 * Keys are sha256 hex digests of the (provider, model, templateVersion, prompt)
 * tuple. Files are stored under a two-character shard directory to avoid huge
 * flat directories on filesystems that struggle with them.
 *
 * Write errors are swallowed so a read-only or otherwise unwritable cache
 * directory can never break the documentation pipeline; we just miss the cache.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface CacheKeyInputs {
  provider: string;
  model: string;
  templateVersion: string;
  prompt: string;
}

export function cacheKey(inp: CacheKeyInputs): string {
  const hash = createHash('sha256');
  hash.update(`${inp.provider}:${inp.model}:${inp.templateVersion}:${inp.prompt}`);
  return hash.digest('hex');
}

function shardPath(cacheDir: string, key: string): string {
  return join(cacheDir, key.slice(0, 2), key);
}

/** Read a cached response, or null if missing/unreadable. */
export async function getCached(cacheDir: string, key: string): Promise<string | null> {
  try {
    return await fs.readFile(shardPath(cacheDir, key), 'utf8');
  } catch {
    return null;
  }
}

/** Write a response to the cache. Swallows write errors silently. */
export async function setCached(cacheDir: string, key: string, response: string): Promise<void> {
  try {
    const file = shardPath(cacheDir, key);
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, response, 'utf8');
  } catch {
    // Intentionally ignore: cache is best-effort.
  }
}
