// src/cli/app.tsx
// Boots the persistent REPL session. Auth gate runs before REPL mounts.
// If credentials are missing/expired → shows LoginFlow, then mounts REPL.
import React, { useState } from 'react';
import { render } from 'ink';
import { REPL } from './REPL.js';
import { LoginFlow } from './components/LoginFlow.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { loadConfig, type RefactronConfig } from '../core/config.js';
import { loadCredentials, isAuthenticated, needsApiKey } from '../auth/index.js';
import type { RefactronCredentials } from '../auth/index.js';
import type { ILanguageAdapter } from '../adapters/interface.js';
import { WorkSessionManager } from '../session/manager.js';
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
  sessions: WorkSessionManager;
}

function AppRoot({
  adapter,
  config,
  version,
  projectRoot,
  initialCreds,
  sessions,
}: AppRootProps): React.ReactElement {
  const [creds, setCreds] = useState<RefactronCredentials | null>(initialCreds);
  const authenticated = isAuthenticated(creds);
  const apiKeyMissing = authenticated && needsApiKey(creds?.plan) && !creds?.api_key;

  if (!authenticated || apiKeyMissing) {
    return (
      <LoginFlow
        version={version}
        adapterName={adapter.displayName}
        onAuthenticated={(newCreds) => setCreds(newCreds)}
        onExit={() => process.exit(0)}
      />
    );
  }

  return (
    <REPL
      ctx={{ adapter, config, projectRoot, sessions }}
      version={version}
      email={creds?.email}
      plan={creds?.plan}
    />
  );
}

/** Enter alternate screen, hide cursor, disable mouse reporting. No-op when not a TTY. */
function enterAltScreen(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[?1049h'); // enter alternate screen buffer
  process.stdout.write('\x1b[H\x1b[2J'); // move to top-left, clear screen
  process.stdout.write('\x1b[?25l');    // hide cursor
  // Disable all mouse reporting modes so scroll wheel doesn't inject arrow keys
  process.stdout.write('\x1b[?1000l'); // disable mouse button tracking
  process.stdout.write('\x1b[?1002l'); // disable mouse drag tracking
  process.stdout.write('\x1b[?1003l'); // disable all mouse motion tracking
  process.stdout.write('\x1b[?1006l'); // disable SGR extended mouse mode
  process.stdout.write('\x1b[?1015l'); // disable URXVT extended mouse mode
}

/** Leave alternate screen, restore cursor, re-enable mouse. Safe to call multiple times. */
function leaveAltScreen(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[?25h');   // show cursor
  process.stdout.write('\x1b[?1049l'); // leave alternate screen
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
  const sessions = new WorkSessionManager(projectRoot);

  // Enter alternate screen BEFORE render() — zero flash, clean viewport.
  enterAltScreen();

  // Guarantee screen restoration on any exit path.
  const restoreOnce = (() => {
    let done = false;
    return () => { if (!done) { done = true; leaveAltScreen(); } };
  })();

  process.on('exit', restoreOnce);
  process.on('SIGINT', () => { restoreOnce(); process.exit(0); });
  process.on('SIGTERM', () => { restoreOnce(); process.exit(0); });

  const { waitUntilExit } = render(
    <AppRoot
      adapter={adapter}
      config={config}
      version={pkg.version}
      projectRoot={projectRoot}
      initialCreds={initialCreds}
      sessions={sessions}
    />,
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
  restoreOnce();
}
