// src/cli/app.tsx
// Boots the persistent REPL session. Mounts once, stays alive until exit() called.
import React from 'react';
import { render } from 'ink';
import { REPL } from './REPL.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { loadConfig } from '../core/config.js';
import { glob } from 'glob';
import { createRequire } from 'module';

async function detectBestAdapter(
  adapters: Awaited<ReturnType<AdapterRegistry['detectAdapters']>>,
  cwd: string,
): Promise<(typeof adapters)[0] | undefined> {
  let best = adapters[0];
  let bestCount = 0;
  for (const a of adapters) {
    const exts = a.extensions.map((e) => e.slice(1)).join(',');
    const pattern = a.extensions.length === 1 ? `${cwd}/**/*.${exts}` : `${cwd}/**/*.{${exts}}`;
    const files = await glob(pattern, {
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    });
    if (files.length > bestCount) {
      bestCount = files.length;
      best = a;
    }
  }
  return best;
}

export async function run(_argv: string[]): Promise<void> {
  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  const registry = new AdapterRegistry();
  const adapters = await registry.detectAdapters(projectRoot);
  const adapter = await detectBestAdapter(adapters, projectRoot);

  if (!adapter) {
    process.stderr.write('No supported language detected in this directory.\n');
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const pkg = require('../../package.json') as { version: string };

  const { waitUntilExit } = render(
    <REPL ctx={{ adapter, config, projectRoot }} version={pkg.version} />,
    { exitOnCtrlC: false }, // Ctrl+C handled inside REPL
  );

  // Block here — this is the "infinite loop"
  // waitUntilExit() resolves only when REPL calls useApp().exit()
  await waitUntilExit();
}
