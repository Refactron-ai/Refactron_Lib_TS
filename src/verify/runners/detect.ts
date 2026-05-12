import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RunnerSpec } from '../types.js';

const DEFAULT_TIMEOUT_MS = 600_000;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export interface DetectOptions {
  override?: string;
  timeoutMs?: number;
}

export async function detectRunner(
  projectRoot: string,
  opts: DetectOptions = {},
): Promise<RunnerSpec | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (opts.override) {
    return { cmd: 'sh', args: ['-c', opts.override], cwd: projectRoot, timeoutMs };
  }
  // Vitest takes precedence over npm test because it's faster and config presence is unambiguous.
  if (
    (await exists(path.join(projectRoot, 'vitest.config.ts'))) ||
    (await exists(path.join(projectRoot, 'vitest.config.js')))
  ) {
    return { cmd: 'npx', args: ['vitest', 'run'], cwd: projectRoot, timeoutMs };
  }
  if (
    (await exists(path.join(projectRoot, 'jest.config.js'))) ||
    (await exists(path.join(projectRoot, 'jest.config.ts')))
  ) {
    return { cmd: 'npx', args: ['jest'], cwd: projectRoot, timeoutMs };
  }
  if (
    (await exists(path.join(projectRoot, 'pyproject.toml'))) ||
    (await exists(path.join(projectRoot, 'pytest.ini'))) ||
    (await exists(path.join(projectRoot, 'setup.cfg')))
  ) {
    return { cmd: 'python3', args: ['-m', 'pytest', '-q'], cwd: projectRoot, timeoutMs };
  }
  return null;
}
