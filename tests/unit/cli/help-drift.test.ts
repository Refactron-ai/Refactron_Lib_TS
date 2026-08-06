// Drift detection between the CLI's help text and its dispatcher.
//
// Before the split, STATIC_HELP advertised analyze, preflight, run, document,
// init and an interactive TUI. Six of those had dispatch branches; the TUI was
// reached by a fallthrough. After the refactoring product was removed, --help
// still listed all of them, because --help is a zero-import fast path that
// prints happily whether or not the modules behind it exist. A user would have
// read the help, run `refactron analyze`, and got ERR_MODULE_NOT_FOUND.
//
// The old catalog had exactly this failure once already, which is why
// transform-ids-drift.test.ts existed. That test left with the transforms;
// this is its replacement for the surface that stayed.
//
// This asserts against the built dispatcher's real behaviour rather than
// against a copy of the strings, so it cannot pass by being updated in lockstep
// with the bug.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const CLI = fileURLToPath(new URL('../../../dist/cli/index.js', import.meta.url));
const built = existsSync(CLI);

/** Runs the CLI and returns stdout+stderr and the exit code, never throwing. */
function run(args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { out: (e.stdout ?? '') + (e.stderr ?? ''), code: e.status ?? -1 };
  }
}

// Verbs listed under "Commands:" in the help output.
function advertisedVerbs(help: string): string[] {
  const block = help.split('Commands:')[1]?.split(/\n\s*\n/)[0] ?? '';
  return block
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((w): w is string => Boolean(w) && /^[a-z][a-z-]*$/.test(w));
}

describe.skipIf(!built)('CLI help and dispatch do not drift', () => {
  it('every verb the help advertises is dispatched', () => {
    const { out: help } = run(['--help']);
    const verbs = advertisedVerbs(help);
    expect(verbs.length).toBeGreaterThan(0);

    for (const verb of verbs) {
      // An unknown command exits 2 AND says "unknown command". A dispatched one
      // may also exit 2 (bad args) but must never claim it is unknown.
      const { out } = run([verb]);
      expect(out, `help advertises '${verb}' but the dispatcher rejects it`).not.toContain(
        `unknown command '${verb}'`,
      );
    }
  });

  it('the help does not advertise the removed refactoring commands', () => {
    const { out: help } = run(['--help']);
    for (const gone of ['analyze', 'preflight', 'run', 'document', 'rollback', 'init']) {
      expect(advertisedVerbs(help), `'${gone}' left with the refactoring product`).not.toContain(
        gone,
      );
    }
  });

  it('a removed command is rejected rather than crashing on a missing module', () => {
    for (const gone of ['analyze', 'run', 'document']) {
      const { out, code } = run([gone]);
      expect(code, `'${gone}' should exit 2`).toBe(2);
      expect(out).toContain(`unknown command '${gone}'`);
      // The specific regression: a dangling dynamic import surfaces as this.
      expect(out).not.toContain('ERR_MODULE_NOT_FOUND');
    }
  });

  it('bare refactron prints help and exits 2 instead of loading a TUI', () => {
    const { out, code } = run([]);
    expect(code).toBe(2);
    expect(out).toContain('verify-diff');
    expect(out).not.toContain('ERR_MODULE_NOT_FOUND');
  });

  it('--version and --help still work as zero-import fast paths', () => {
    const v = run(['--version']);
    expect(v.code).toBe(0);
    expect(v.out.trim()).toMatch(/^\d+\.\d+\.\d+/);

    const h = run(['--help']);
    expect(h.code).toBe(0);
    expect(h.out).toContain('verification layer');
  });

  it('login is reachable, which the auth gate depends on', () => {
    // verify-diff exits 7 telling the user to run `refactron login`. If that
    // verb is not dispatched, the product is gated with no way in.
    const { out } = run(['login', '--help']);
    expect(out).not.toContain("unknown command 'login'");
  });
});
