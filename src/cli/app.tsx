// src/cli/app.tsx
import React from 'react';
import { render } from 'ink';
import { AnalyzeCommand } from './commands/analyze.js';
import { AutofixCommand } from './commands/autofix.js';
import { StatusCommand } from './commands/status.js';
import type { AnalysisResult } from '../core/models.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { AnalysisEngine } from '../analysis/engine.js';
import { Orchestrator } from '../core/orchestrator.js';
import { SessionStore } from '../pipeline/store.js';
import { loadConfig } from '../core/config.js';
import path from 'path';

function parseArgs(argv: string[]): {
  command: string;
  target: string;
  failOn: string | null;
  dryRun: boolean;
  verify: boolean;
  format: string;
} {
  const [command = 'analyze', ...rest] = argv;
  let target = '.';
  let failOn: string | null = null;
  let dryRun = false;
  let verify = false;
  let format = 'terminal';

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg) continue;
    if (arg === '--fail-on' && rest[i + 1]) {
      failOn = rest[i + 1] ?? null;
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--verify') {
      verify = true;
    } else if (arg === '--format' && rest[i + 1]) {
      format = rest[i + 1] ?? 'terminal';
      i++;
    } else if (!arg.startsWith('--')) {
      target = arg;
    }
  }

  return { command, target, failOn, dryRun, verify, format };
}

export async function run(argv: string[]): Promise<void> {
  const { command, target, failOn, dryRun, verify } = parseArgs(argv);
  const analysisTarget = path.resolve(target);
  // Project root is cwd (where tsconfig.json / package.json lives)
  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  const registry = new AdapterRegistry();
  const adapters = await registry.detectAdapters(projectRoot);

  // Pick adapter with the most file matches in the target
  const { glob } = await import('glob');
  let adapter = adapters[0];
  let bestCount = 0;
  for (const a of adapters) {
    const exts = a.extensions.map((e) => e.slice(1)).join(',');
    const pattern =
      a.extensions.length === 1
        ? `${analysisTarget}/**/*.${exts}`
        : `${analysisTarget}/**/*.{${exts}}`;
    const files = await glob(pattern, {
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    });
    if (files.length > bestCount) {
      bestCount = files.length;
      adapter = a;
    }
  }

  if (!adapter) {
    process.stderr.write('No supported language detected in target directory.\n');
    process.exit(1);
  }

  if (command === 'analyze') {
    const engine = new AnalysisEngine(adapter, config);
    render(
      <AnalyzeCommand
        target={analysisTarget}
        analyze={(t) => engine.analyze(t)}
        onAnalysisComplete={(result: AnalysisResult) => {
          const hasCritical = result.issues.some((i) => i.severity === 'critical');
          const hasHigh = result.issues.some((i) => i.severity === 'high');
          if (failOn === 'critical' && hasCritical) setTimeout(() => process.exit(1), 100);
          if (failOn === 'high' && (hasCritical || hasHigh)) setTimeout(() => process.exit(1), 100);
        }}
      />,
    );
    return;
  }

  if (command === 'autofix') {
    const orchestrator = new Orchestrator(adapter, config, projectRoot);
    render(
      <AutofixCommand
        target={analysisTarget}
        dryRun={dryRun}
        verify={verify || config.autofix.require_verification}
        autofix={(t, opts) => orchestrator.autofix(t, opts)}
      />,
    );
    return;
  }

  if (command === 'status') {
    const store = new SessionStore(projectRoot);
    render(<StatusCommand getStatus={() => store.latest()} />);
    return;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  process.stderr.write('Run: refactron --help\n');
  process.exit(1);
}
