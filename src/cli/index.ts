#!/usr/bin/env node
// src/cli/index.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];

const STATIC_HELP = `
  refactron — safety-first refactoring

  Commands:
    analyze  [target]              Scan for transform patterns
    run      [target] [--apply]    Plan + verify + apply transforms (default dry-run)
    document [target]              Generate docstrings for verified refactors (Week 6)
    init     [target]              Scaffold .refactronrc.json
    login    [--print-token]       Authenticate with Refactron

  Run with no args to enter the interactive TUI.

  analyze flags:
    --json                  Machine-readable output
    --confidence=<level>    high | medium | low (default: high)
    --fail-on=<level>       Exit 1 if any finding at this confidence or above
    --graph=<path>          Write import + call graph JSON

  run flags:
    --apply                 Actually write to disk (otherwise dry-run)
    --transforms=<list>     Comma-separated transform ids, or 'all'
    --confidence=<level>    Same semantics as analyze
    --test-cmd=<cmd>        Override the auto-detected test runner
    --json                  Machine-readable output

  Auth:
    Set REFACTRON_TOKEN env var, or run 'refactron login' to persist credentials.

  Examples:
    refactron analyze src/
    refactron analyze src/ --json --fail-on=high
    refactron run fixtures/python-legacy-mini --dry-run
    refactron run --apply --transforms=format_to_fstring,class_to_dataclass .
    refactron init my-project/
`;

// Fast paths — zero imports, <10ms
if (cmd === '--version' || cmd === '-v') {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  process.stdout.write(pkg.version + '\n');
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h') {
  process.stdout.write(STATIC_HELP);
  process.exit(0);
}

if (cmd === 'analyze') {
  const { runAnalyzeCommand } = await import('./analyze-command.js');
  const code = await runAnalyzeCommand(process.argv.slice(3));
  process.exit(code);
}

if (cmd === 'run') {
  const { runRunCommand } = await import('./run-command.js');
  const code = await runRunCommand(process.argv.slice(3));
  process.exit(code);
}

if (cmd === 'init') {
  const { runInitCommand } = await import('./init-command.js');
  process.exit(await runInitCommand(process.argv.slice(3)));
}

if (cmd === 'login' && process.argv.includes('--print-token')) {
  const { runLoginFlow } = await import('../auth/device-auth.js');
  const { creds } = await runLoginFlow(false, () => {});
  process.stdout.write((creds?.access_token ?? '') + '\n');
  process.exit(creds?.access_token ? 0 : 1);
}

// v2.0 subcommands not yet wired into the CLI. Reject them deterministically so
// platforms whose stdin EOF makes the REPL fallback exit 0 don't mask the gap.
// `document` lands in Week 6.
const V2_PENDING = new Set(['document']);
if (cmd !== undefined && V2_PENDING.has(cmd)) {
  process.stderr.write(`refactron: subcommand '${cmd}' is not yet implemented in this build.\n`);
  process.exit(13);
}

// Full application load only when needed
const { run } = await import('./app.js');
await run(process.argv.slice(2));
