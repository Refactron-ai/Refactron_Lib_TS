// src/cli/app.tsx
// Boots the persistent REPL session. Auth gate runs before REPL mounts.
// If credentials are missing/expired → shows LoginFlow, then mounts REPL.
import React, { useState } from 'react';
import { render } from 'ink';
import { REPL } from './REPL.js';
import { LoginFlow } from './components/LoginFlow.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { loadConfig, type RefactronConfig } from '../core/config.js';
import { loadCredentials, isAuthenticated } from '../auth/index.js';
import type { RefactronCredentials } from '../auth/index.js';
import type { ILanguageAdapter } from '../adapters/interface.js';
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

interface AppRootProps {
  adapter: ILanguageAdapter;
  config: RefactronConfig;
  version: string;
  projectRoot: string;
  initialCreds: RefactronCredentials | null;
}

function AppRoot({
  adapter,
  config,
  version,
  projectRoot,
  initialCreds,
}: AppRootProps): React.ReactElement {
  const [authenticated, setAuthenticated] = useState(isAuthenticated(initialCreds));

  if (!authenticated) {
    return (
      <LoginFlow onAuthenticated={() => setAuthenticated(true)} onExit={() => process.exit(0)} />
    );
  }

  return <REPL ctx={{ adapter, config, projectRoot }} version={version} />;
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

  const initialCreds = await loadCredentials();

  const { waitUntilExit } = render(
    <AppRoot
      adapter={adapter}
      config={config}
      version={pkg.version}
      projectRoot={projectRoot}
      initialCreds={initialCreds}
    />,
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
}
