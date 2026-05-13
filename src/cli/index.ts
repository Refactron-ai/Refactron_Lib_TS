#!/usr/bin/env node
// src/cli/index.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];

const STATIC_HELP = `
  refactron v0.1.0-beta.1 — safety-first refactoring

  Commands:
    analyze [target]      Analyze files for issues
    autofix [target]      Fix issues with verification
    verify  [file]        Verify a specific file
    rollback              Rollback last applied fixes
    status                Show current session status
    diff [target]         Show diff for a fix

  Options:
    --fail-on <level>     Exit non-zero if issues at level found (critical|high|medium|low)
    --format <fmt>        Output format: terminal|json|sarif
    --dry-run             Preview fixes without writing
    --verify              Require verification before applying

  Examples:
    refactron analyze src/
    refactron autofix . --verify
    refactron autofix . --dry-run
    refactron status
    refactron rollback
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
