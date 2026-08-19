// tests/unit/verify/runner-env-redaction.test.ts
//
// SEC-3. The tests gate spawns the repository's own test suite - code supplied
// by the diff under verification - and handed it `{...process.env}`. In the
// deployment this product is sold for, a CI gate verifying an untrusted pull
// request, that environment is full of credentials.
//
// Reproduced before the fix: a test in the verified suite read
// REFACTRON_TOKEN, GITHUB_TOKEN, NPM_TOKEN and AWS_SECRET_ACCESS_KEY in
// plaintext.
//
// A denylist, not an allowlist: real suites need HOME, PATH, LANG and a long
// tail of toolchain variables, and an allowlist would break them. The denylist
// closes the credentials a verification run has no business forwarding.
import { describe, it, expect } from 'vitest';
import { redactEnvForRunner } from '../../../src/verify/runners/run.js';

describe('the verified suite does not inherit our credentials', () => {
  it('strips the token Refactron itself authenticates with', () => {
    const out = redactEnvForRunner({ REFACTRON_TOKEN: 'sk_live_x', PATH: '/usr/bin' });
    expect(out.REFACTRON_TOKEN).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
  });

  it('strips the CI credentials most likely to be present in the gate', () => {
    const secrets = {
      GITHUB_TOKEN: 'ghp_x',
      GH_TOKEN: 'gh_x',
      NPM_TOKEN: 'npm_x',
      NODE_AUTH_TOKEN: 'na_x',
      AWS_SECRET_ACCESS_KEY: 'aws_x',
      AWS_SESSION_TOKEN: 'aws_s',
      PYPI_API_TOKEN: 'pypi_x',
    };
    const out = redactEnvForRunner({ ...secrets, HOME: '/home/u' });
    for (const k of Object.keys(secrets)) expect(out[k], `${k} leaked`).toBeUndefined();
    expect(out.HOME).toBe('/home/u');
  });

  it('strips by suffix, so a variable we never enumerated is still caught', () => {
    // The denylist cannot list every secret name in existence. Anything whose
    // name ends in _TOKEN, _SECRET, _API_KEY, _PASSWORD or _CREDENTIALS goes.
    const out = redactEnvForRunner({
      SOME_VENDOR_TOKEN: 'x',
      OTHER_SECRET: 'x',
      THING_API_KEY: 'x',
      DB_PASSWORD: 'x',
      GCP_CREDENTIALS: 'x',
      MY_TOKENIZER_PATH: '/opt/tok',
    });
    for (const k of [
      'SOME_VENDOR_TOKEN',
      'OTHER_SECRET',
      'THING_API_KEY',
      'DB_PASSWORD',
      'GCP_CREDENTIALS',
    ])
      expect(out[k], `${k} leaked`).toBeUndefined();
    // Not a false positive: the suffix rule must not eat an ordinary variable.
    expect(out.MY_TOKENIZER_PATH).toBe('/opt/tok');
  });

  it('leaves the variables a real test suite needs', () => {
    const keep = {
      PATH: '/usr/bin',
      HOME: '/home/u',
      LANG: 'en_US.UTF-8',
      PYTHONPATH: 'src',
      VIRTUAL_ENV: '/venv',
      NODE_OPTIONS: '--max-old-space-size=4096',
      TMPDIR: '/tmp',
    };
    expect(redactEnvForRunner(keep)).toEqual(keep);
  });

  it('does not mutate the environment it was given', () => {
    const original = { REFACTRON_TOKEN: 'x', PATH: '/usr/bin' };
    redactEnvForRunner(original);
    expect(original.REFACTRON_TOKEN).toBe('x');
  });
});

// The unit tests above pass against a redaction that does nothing, because they
// test the pure function rather than the spawn. execa MERGES `env` over
// process.env unless `extendEnv: false` is set, so the first version of this fix
// changed nothing observable and only an end-to-end probe caught it. This test
// exercises the real spawn.
describe('the redaction survives the spawn, not just the function', () => {
  it('a child process cannot read REFACTRON_TOKEN, but still has PATH', async () => {
    const { runRunner } = await import('../../../src/verify/runners/run.js');
    const os = await import('node:os');
    const saved = process.env.REFACTRON_TOKEN;
    process.env.REFACTRON_TOKEN = 'sk_live_canary';
    try {
      const r = (await runRunner({
        cmd: 'sh',
        args: ['-c', 'echo "tok=[${REFACTRON_TOKEN:-unset}] path=[${PATH:+yes}]"'],
        cwd: os.tmpdir(),
        timeoutMs: 30_000,
      } as never)) as unknown as { stdout: string };
      expect(r.stdout).toContain('tok=[unset]');
      expect(r.stdout).toContain('path=[yes]');
    } finally {
      if (saved === undefined) delete process.env.REFACTRON_TOKEN;
      else process.env.REFACTRON_TOKEN = saved;
    }
  }, 60_000);
});
