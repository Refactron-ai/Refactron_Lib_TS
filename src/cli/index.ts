#!/usr/bin/env node
// src/cli/index.ts
//
// Two verbs, both one-shot. There is no interactive mode: this is a gate you
// run from CI or from an agent, and the same engine is exposed over MCP by the
// `refactron-mcp` binary.
//
// Every verb below must appear in STATIC_HELP and vice versa;
// tests/unit/cli/help-drift.test.ts asserts it, because the previous help text
// advertised six commands that had been removed from the dispatcher.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];

const STATIC_HELP = `
  refactron — a verification layer for code change

  Verifies a diff before it lands: applies it in an isolated shadow tree, runs
  your real test suite against it, and checks whether those tests actually
  exercise the lines that changed. Your working tree is never touched.

  Commands:
    verify-diff [repo] --diff <f>  Verify a diff → SAFE / UNSAFE / UNPROVEN
    login       [--print-token]    Authenticate with Refactron

  verify-diff flags:
    --diff=<file>           Unified/git diff to verify (required)
    --test-cmd=<cmd>        Override the detected test command
    --json                  Machine-readable verdict report

  Exit codes:
    0   SAFE, or UNPROVEN
    1   UNSAFE — a gate failed
    2   unusable input (no diff, bad diff, bad flag)
    7   not authenticated

  Auth:
    Set REFACTRON_TOKEN, or run 'refactron login' to persist credentials.

  For AI agents, run the MCP server instead: refactron-mcp
  It exposes the same engine as a verify_change tool.

  Examples:
    refactron verify-diff . --diff change.diff
    refactron verify-diff . --diff change.diff --json
    git diff HEAD~1 > c.diff && refactron verify-diff . --diff c.diff
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

if (cmd === 'verify-diff') {
  const { runVerifyDiffCommand } = await import('./verify-diff-command.js');
  const code = await runVerifyDiffCommand(process.argv.slice(3));
  process.exit(code);
}

if (cmd === 'login') {
  const printToken = process.argv.includes('--print-token');
  const { runLoginFlow } = await import('../auth/device-auth.js');

  // Status goes to stderr so `refactron login --print-token` stays pipeable:
  // the token is the only thing on stdout. Previously this callback was
  // discarded entirely, so the device code and verification URL were never
  // shown and the flow could not be completed by a human.
  const onStatus = (msg: string): void => {
    process.stderr.write(msg + '\n');
  };

  try {
    const { creds } = await runLoginFlow(false, onStatus);
    const token = creds?.access_token ?? '';
    if (printToken) process.stdout.write(token + '\n');
    process.exit(token ? 0 : 1);
  } catch (err) {
    process.stderr.write(`refactron login: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

// No interactive fallthrough. Bare `refactron` used to load the Ink TUI; that
// application is gone, so an unrecognised or absent command prints help and
// exits 2 rather than throwing ERR_MODULE_NOT_FOUND.
if (cmd === undefined) {
  process.stdout.write(STATIC_HELP);
  process.exit(2);
}

process.stderr.write(`refactron: unknown command '${cmd}'\n`);
process.stderr.write(STATIC_HELP);
process.exit(2);
