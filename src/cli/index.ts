#!/usr/bin/env node
// src/cli/index.ts
import { createRequire } from 'module';

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
if (!cmd || cmd === '--version' || cmd === '-v') {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const pkg = require('../../package.json') as { version: string };
  process.stdout.write(pkg.version + '\n');
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h') {
  process.stdout.write(STATIC_HELP);
  process.exit(0);
}

// Full application load only when needed
const { run } = await import('./app.js');
await run(process.argv.slice(2));
