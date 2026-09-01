import { execa } from 'execa';
import type { RunnerSpec } from '../types.js';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface RunOptions {
  retries?: number;
  onAttempt?: (attempt: number) => void;
  // Extra env vars merged over the redacted base. Used by mutation to force
  // fresh bytecode (PYTHONDONTWRITEBYTECODE), so a mutant is not masked by a
  // stale .pyc of the original from an earlier run.
  envAdd?: Record<string, string>;
}

/** Credentials that must not reach the verified suite.
 *
 *  The tests gate spawns the repository's OWN test suite - code supplied by the
 *  diff under verification - and it used to inherit the full parent
 *  environment. In the deployment this product is sold for, a CI gate verifying
 *  an untrusted pull request, that environment holds the credentials of the
 *  repository it is protecting. Reproduced before this existed: a test in the
 *  verified suite read REFACTRON_TOKEN, GITHUB_TOKEN, NPM_TOKEN and
 *  AWS_SECRET_ACCESS_KEY in plaintext.
 *
 *  A DENYLIST, not an allowlist. Real suites need HOME, PATH, LANG, VIRTUAL_ENV
 *  and a long tail of toolchain variables; an allowlist would break them and
 *  would be a support burden forever. This closes the credentials a verification
 *  run has no business forwarding, and is explicitly not a sandbox: running the
 *  suite is running the repository's code, which SECURITY.md states plainly. */
const DENIED_ENV_EXACT = new Set([
  'REFACTRON_TOKEN',
  'REFACTRON_API_BASE_URL',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'PYPI_API_TOKEN',
  'TWINE_PASSWORD',
  'DOCKER_PASSWORD',
  'SLACK_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
]);

/** Suffixes that mark a value as a credential regardless of vendor. The exact
 *  list above can never be complete, and a new vendor's token should not need a
 *  release here to be redacted. `_TOKEN` matches `VENDOR_TOKEN` but not
 *  `TOKENIZER_PATH`, because the match is on the whole trailing segment. */
const DENIED_ENV_SUFFIXES = ['_TOKEN', '_SECRET', '_API_KEY', '_PASSWORD', '_CREDENTIALS'];

export function redactEnvForRunner(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (DENIED_ENV_EXACT.has(key)) continue;
    if (DENIED_ENV_SUFFIXES.some((suffix) => key.endsWith(suffix))) continue;
    out[key] = value;
  }
  return out;
}

export async function runRunner(spec: RunnerSpec, opts: RunOptions = {}): Promise<RunResult> {
  const retries = Math.max(0, opts.retries ?? 0);
  let last: RunResult | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    opts.onAttempt?.(attempt);
    const t0 = Date.now();
    try {
      const r = await execa(spec.cmd, spec.args, {
        cwd: spec.cwd,
        timeout: spec.timeoutMs,
        reject: false,
        // extendEnv:false is load-bearing. execa MERGES `env` over process.env by
        // default, so passing a redacted copy changes nothing - execa puts every
        // secret straight back. The unit test on redactEnvForRunner passed while
        // the end-to-end probe still read every credential; only turning the
        // merge off actually removes them. The redacted copy already carries
        // PATH, HOME and the rest, so the child loses nothing it needs.
        extendEnv: false,
        env: { ...redactEnvForRunner(process.env), ...opts.envAdd, CI: '1' },
      });
      const elapsedMs = Date.now() - t0;
      // execa's r.timedOut field is unreliable across Node versions when
      // reject:false is set (notably Node 18 leaves it undefined even after
      // a real timeout fire). Derive timedOut from observable wall-clock:
      // if the process was killed by a signal AND the elapsed time has
      // reached the configured timeout, the timeout fired.
      const timedOut =
        r.timedOut === true || (typeof r.signal === 'string' && elapsedMs >= spec.timeoutMs);
      last = {
        exitCode: r.exitCode ?? 1,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut,
        durationMs: elapsedMs,
      };
      if (last.exitCode === 0 && !last.timedOut) return last;
    } catch (err) {
      const e = err as {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
        timedOut?: boolean;
        message: string;
      };
      last = {
        exitCode: e.exitCode ?? 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message,
        timedOut: e.timedOut === true,
        durationMs: Date.now() - t0,
      };
    }
  }
  return last!;
}
