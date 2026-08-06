// Drift detection between the CLI's help text and its dispatcher.
//
// Before the split, STATIC_HELP advertised analyze, preflight, run, document,
// init and an interactive TUI. After the refactoring product was removed,
// --help still listed all of them, because --help is a zero-import fast path
// that prints happily whether or not the modules behind it exist. A user would
// have read the help, run `refactron analyze`, and got ERR_MODULE_NOT_FOUND.
//
// The first version of this file did not actually catch that. Review killed it
// with two mutants that both stayed green:
//
//   1. advertise a NEW verb whose dynamic import dangles. The loop asserted
//      only `not.toContain("unknown command '<verb>'")`, and a crash does not
//      contain that string. Fixed by asserting ERR_MODULE_NOT_FOUND and
//      non-empty output INSIDE the loop.
//   2. re-advertise `analyze` after a blank line. advertisedVerbs() read only
//      the first blank-line-delimited block, so the parse silently missed it.
//      Fixed by parsing to the end of the indented block and asserting the
//      exact verb list with toEqual rather than containment.
//
// It also could not run at all: the CI `test` job is `npm ci` + `npm test` with
// no build, so `describe.skipIf(!existsSync(dist))` skipped all six tests in
// all nine matrix jobs and reported exit 0. `dist/` is repo state CI controls,
// not an environment fact like a missing python3, so a missing build is now a
// hard failure rather than a skip. tests/e2e/document.test.ts had this right
// before it left with the removed product.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const CLI = fileURLToPath(new URL('../../../dist/cli/index.js', import.meta.url));
const PKG = fileURLToPath(new URL('../../../package.json', import.meta.url));
const SRC = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

if (!existsSync(CLI)) {
  throw new Error(
    `dist CLI not found at ${CLI}. Run \`npm run build\` before \`npm test\`. ` +
      'This is deliberately a throw and not a skip: every assertion below is ' +
      'about the shipped binary, and skipping on a missing build is how six of ' +
      'them silently stopped running in CI.',
  );
}

/** The verbs the dispatcher handles. Every one must be advertised, and vice versa. */
const EXPECTED_VERBS = ['login', 'verify-diff'];

/** Removed in 0.4.0 with migration mode. None may be advertised or dispatched. */
const REMOVED = ['analyze', 'preflight', 'run', 'document', 'rollback', 'init'];

/**
 * Runs the CLI and returns combined output plus exit code, never throwing.
 *
 * execFileSync is synchronous, so vitest's testTimeout cannot interrupt it: a
 * hanging child blocks the worker and is never reaped. `login` used to poll
 * until its device code expired, which is exactly that. The timeout turns a
 * hang into a named failure instead of a stuck suite.
 */
function run(args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      killSignal: 'SIGKILL',
    });
    return { out, code: 0 };
  } catch (err) {
    const e = err as { status?: number; signal?: string; stdout?: string; stderr?: string };
    if (e.signal === 'SIGKILL') {
      throw new Error(`\`refactron ${args.join(' ')}\` did not exit within 10s`);
    }
    return { out: (e.stdout ?? '') + (e.stderr ?? ''), code: e.status ?? -1 };
  }
}

/**
 * Verbs listed under "Commands:" in the help output.
 *
 * Command rows are indented four spaces; section headings ("verify-diff flags:",
 * "Examples:") sit at two. So the block ends at the first line indented LESS
 * than four, and a blank line does NOT end it — stopping at the first blank line
 * is what let a re-advertised `analyze` hide below one and keep the suite green.
 */
function advertisedVerbs(help: string): string[] {
  const afterHeading = help.split('Commands:')[1] ?? '';
  const verbs: string[] = [];
  for (const line of afterHeading.split('\n')) {
    if (/^ {0,3}\S/.test(line)) break; // next section heading
    const word = line.trim().split(/\s+/)[0];
    if (word && /^[a-z][a-z-]*$/.test(word)) verbs.push(word);
  }
  return verbs;
}

describe('CLI help and dispatch do not drift', () => {
  it('advertises exactly the verbs the dispatcher handles', () => {
    // toEqual, not toContain: containment cannot see an EXTRA advertised verb,
    // which is the drift that strands a user.
    expect(advertisedVerbs(run(['--help']).out).sort()).toEqual([...EXPECTED_VERBS].sort());
  });

  it('every advertised verb dispatches without crashing', () => {
    const verbs = advertisedVerbs(run(['--help']).out);
    expect(verbs.length).toBeGreaterThan(0);

    for (const verb of verbs) {
      const { out } = run([verb, '--help']);
      expect(out, `help advertises '${verb}' but the dispatcher rejects it`).not.toContain(
        `unknown command '${verb}'`,
      );
      // The regression this file exists for. Without this line, an advertised
      // verb whose dynamic import dangles passes.
      expect(out, `'${verb}' crashed on a missing module`).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(out.trim(), `'${verb}' produced no output at all`).not.toBe('');
    }
  });

  it('every dispatched verb is advertised, the direction the source claims', () => {
    // src/cli/index.ts states the biconditional in a comment and this asserts
    // the half the original file missed. It reads the dispatcher's SOURCE
    // against the BUILT binary's help, so it is still not a copy of the strings.
    const src = readFileSync(SRC, 'utf8');
    const dispatched = [...src.matchAll(/cmd === '([a-z][a-z-]*)'/g)].map((m) => m[1] as string);
    expect(dispatched.length).toBeGreaterThan(0);

    const advertised = new Set(advertisedVerbs(run(['--help']).out));
    for (const verb of dispatched) {
      expect(advertised, `dispatcher handles '${verb}' but --help never mentions it`).toContain(
        verb,
      );
    }
  });

  it('does not advertise anything removed in 0.4.0', () => {
    const verbs = advertisedVerbs(run(['--help']).out);
    expect(verbs.length).toBeGreaterThan(0); // never assert against a vacuous []
    for (const gone of REMOVED) {
      expect(verbs, `'${gone}' left with the refactoring product`).not.toContain(gone);
    }
  });

  it('a removed command names the removal and the pin, and does not crash', () => {
    for (const gone of REMOVED) {
      const { out, code } = run([gone]);
      expect(code, `'${gone}' should exit 2`).toBe(2);
      expect(out, `'${gone}' should say it was removed`).toContain('removed in 0.4.0');
      expect(out, `'${gone}' should name the pin`).toContain('refactron@0.3.1');
      expect(out).not.toContain('ERR_MODULE_NOT_FOUND');
    }
  });

  it('an unrecognised command is rejected without crashing', () => {
    const { out, code } = run(['definitely-not-a-verb']);
    expect(code).toBe(2);
    expect(out).toContain("unknown command 'definitely-not-a-verb'");
    expect(out).not.toContain('ERR_MODULE_NOT_FOUND');
  });

  it('bare refactron prints help and exits 2 instead of loading a TUI', () => {
    const { out, code } = run([]);
    expect(code).toBe(2);
    expect(out).toContain('verify-diff');
    expect(out).not.toContain('ERR_MODULE_NOT_FOUND');
  });

  it('the built binary under test came from this checkout', () => {
    // Every assertion here reads a build artifact, so without this a stale dist
    // from another branch satisfies the whole file.
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { version: string };
    expect(run(['--version']).out.trim()).toBe(pkg.version);
  });

  it('--help is a zero-import fast path describing this product', () => {
    const h = run(['--help']);
    expect(h.code).toBe(0);
    expect(h.out).toContain('verification layer');
  });

  it('login --help prints help without starting a device flow', () => {
    // Guarded in the dispatcher BEFORE importing device-auth. Without that
    // guard this test made a live call to the production API and, on a
    // networked machine, spawned a browser out of `npm test`.
    const { out, code } = run(['login', '--help']);
    expect(code).toBe(0);
    expect(out).toContain('verify-diff');
    expect(out).not.toContain('Requesting device code');
  });
});
