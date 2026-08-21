// tests/unit/release/release-workflow.test.ts
//
// Guards the invariants of .github/workflows/release.yml that only a release can
// otherwise test. Renamed from publish-job-hardening.test.ts in #135, when the
// second invariant (token scope) joined the first (dependency scripts): both are
// about what the release pipeline is allowed to do, and splitting them would
// duplicate the parser below.
//
// Issue #133 (SEC-7). The `publish-npm` job holds `id-token: write` for the npm
// trusted publisher, so it can mint a token that publishes `refactron`. Any
// dependency lifecycle script running in that job runs with that capability,
// which makes one compromised transitive dependency enough to publish under our
// name.
//
// The fix is one flag on one line, which is exactly the kind of change that gets
// "tidied" back by someone who reads `--ignore-scripts` as noise. The comment at
// the call site explains why it is there; this test is what makes removing it
// fail rather than ship.
//
// Parsed textually, on purpose. The only YAML parser in the tree (`js-yaml`) is
// transitive, so importing it would make this test evaporate on an unrelated
// dependency bump - a guard that can silently stop guarding is worse than none.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORKFLOW = path.join(REPO, '.github/workflows/release.yml');

/** The lines of one top-level job, from `  <name>:` to the next job at the same
 *  indent. Returning the block rather than the whole file is what keeps this
 *  test about the PUBLISH job: `test-before-release` deliberately keeps its
 *  lifecycle scripts, so a file-wide assertion would be wrong, not just loose. */
/** The executable dependency-install steps in a job.
 *
 *  Anchored on `- run:` rather than matching bare text, because a COMMENT
 *  mentioning `npm ci` would otherwise satisfy these assertions after the real
 *  command was removed. That is not hypothetical here: the comment at the call
 *  site is specifically about the `--ignore-scripts` flag, so the hole would be
 *  one well-meaning edit away.
 *
 *  `-g` is excluded, and finding out why is what this comment is for. The
 *  publish job must run `npm install -g npm@^11.5.1`, because npm OIDC
 *  trusted-publisher auth needs npm >= 11.5.1 and Node 20 ships an older
 *  bundled npm. That is a global tool install, not this project's dependency
 *  tree, and demanding `--ignore-scripts` on it would be wrong. `install`
 *  without `-g` IS covered, so swapping `npm ci` for `npm install` cannot
 *  quietly slip past the guard. */
function npmInstallSteps(source: string, job: string): string[] {
  return jobBlock(source, job).filter(
    (l) => /^\s*-\s+run:\s+npm\s+(ci|install)\b/.test(l) && !/\s(-g|--global)\b/.test(l),
  );
}

function jobBlock(source: string, job: string): string[] {
  // `\r?\n`, not `\n`. A Windows checkout with autocrlf gives every line a
  // trailing \r, so `l === '  publish-npm:'` never matched and this threw
  // "job not found" on all three Windows runners. Caught in CI on the very PR
  // that added the test, which this repository has seen before.
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start === -1) throw new Error(`job "${job}" not found in release.yml`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}\S/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the release workflow does not run dependency scripts where it can publish', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');

  it('installs with --ignore-scripts in the publish job', () => {
    const installs = npmInstallSteps(source, 'publish-npm');
    // Guards the guard: if the step is renamed or dropped, an empty list would
    // make `every()` vacuously true and this test would pass on a job that no
    // longer installs anything the way we think it does.
    expect(installs.length).toBeGreaterThan(0);
    for (const line of installs) expect(line).toContain('--ignore-scripts');
  });

  it('reads a CRLF checkout, which is how this test first failed', () => {
    // Not a hypothetical. The first version split on '\n' and threw
    // "job not found" on all three Windows runners, because autocrlf leaves a
    // trailing \r on every line. Pinned against a synthetic CRLF source so the
    // fix cannot regress on the two thirds of CI that run on Linux and macOS.
    // Normalize to LF FIRST. On a Windows runner `source` is ALREADY CRLF, so
    // replacing bare \n produced \r\r\n and this test failed there on its
    // first run - the CRLF regression test having its own CRLF bug. Going
    // through LF makes the fixture identical on every platform.
    const crlf = source.replace(/\r?\n/g, '\r\n');
    const installs = npmInstallSteps(crlf, 'publish-npm');
    expect(installs.length).toBeGreaterThan(0);
    for (const line of installs) expect(line).toContain('--ignore-scripts');
  });

  it('leaves the test job alone, which is a decision and not an oversight', () => {
    // vitest reaches esbuild's platform binary, installed by a postinstall hook,
    // and that job executes repository code by design anyway. Pinned so that
    // "harden the other one too" is a conversation rather than a silent change
    // that breaks the release at the worst possible moment.
    const installs = npmInstallSteps(source, 'test-before-release');
    expect(installs.length).toBeGreaterThan(0);
    for (const line of installs) expect(line).not.toContain('--ignore-scripts');
  });
});

// Issue #135. The workflow used to grant `contents: write` and `id-token: write`
// to ALL five jobs, with only the two publish jobs opting back down.
//
// `id-token: write` is the one that matters. It mints an OIDC token, and our npm
// trusted publisher accepts one to publish `refactron`. `test-before-release`
// installs the dependency tree with lifecycle scripts ENABLED, deliberately (see
// #133), so it was a job running third-party install hooks while holding the
// capability to publish under our name.
//
// #133 removed the scripts from the job with the identity. This removes the
// identity from the jobs running scripts. Neither subsumes the other, and this
// test pins the second half.

/** The `permissions:` mapping declared at a given indent, as `key: value` pairs.
 *
 *  Hand-parsed for the reason given at the top of this file. Kept honest by
 *  `parses a synthetic workflow it does not control` below, which runs it over
 *  input with a KNOWN answer - a bespoke parser that is only ever fed the file
 *  it was written against proves nothing about its own correctness. */
function permissionsAt(lines: string[], indent: number): Record<string, string> | null {
  const pad = ' '.repeat(indent);
  const start = lines.findIndex((l) => new RegExp(`^${pad}permissions:(\\s|$)`).test(l));
  if (start === -1) return null;

  // YAML also allows the SCALAR form - `permissions: write-all`, `read-all`, or
  // `{}` - which this parser does not model. Throwing is not pedantry: the
  // earlier version matched the mapping header exactly, so a scalar returned an
  // empty mapping and `perms['id-token']` read `undefined`. Verified before this
  // guard existed: giving `test-before-release` a literal `permissions:
  // write-all` left all eight tests GREEN while that job held the exact
  // capability this file exists to deny it. An unmodelled shape must fail loudly,
  // never report "no permissions found".
  const inline = lines[start]!.slice(`${pad}permissions:`.length).trim();
  if (inline !== '') {
    throw new Error(
      `unmodelled permissions shape at indent ${indent}: "permissions: ${inline}". ` +
        'This parser models the mapping form only; extend it rather than deleting this check.',
    );
  }

  const out: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const depth = line.length - line.trimStart().length;
    if (depth <= indent) break; // dedented out of the mapping
    const m = /^([\w-]+):\s*(\S+)/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/** What a job actually gets. A job-level block REPLACES the workflow-level set
 *  rather than merging with it, which is the mechanic this whole issue turns on
 *  and is already documented at the `publish-pypi` call site. */
function effectivePermissions(source: string, job: string): Record<string, string> {
  const lines = source.split(/\r?\n/);
  const own = permissionsAt(jobBlock(source, job), 4);
  return own ?? permissionsAt(lines, 0) ?? {};
}

function jobNames(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const start = lines.indexOf('jobs:');
  return lines
    .slice(start + 1)
    .filter((l) => /^ {2}[\w-]+:$/.test(l))
    .map((l) => l.trim().replace(':', ''));
}

describe('release.yml grants the publishing capability to publish jobs only', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  // Named rather than derived: deriving "the jobs allowed to have id-token" from
  // the file would make this test agree with whatever the file says, which is
  // the definition of a tautology.
  const MAY_MINT_A_TOKEN = ['publish-npm', 'publish-pypi'];

  it('finds all five jobs, so the sweep below is not over an empty list', () => {
    expect(jobNames(source).sort()).toEqual([
      'github-release',
      'publish-npm',
      'publish-pypi',
      'test-before-release',
      'validate-tag',
    ]);
  });

  it('gives id-token to the two publish jobs and nothing else', () => {
    for (const job of jobNames(source)) {
      const perms = effectivePermissions(source, job);
      const expected = MAY_MINT_A_TOKEN.includes(job) ? 'write' : undefined;
      expect(perms['id-token'], `job ${job}`).toBe(expected);
    }
  });

  it('keeps the workflow-level default read-only', () => {
    // The inherited set. If this regains write, every job without its own block
    // silently regains it too, which is exactly how the original state arose.
    expect(permissionsAt(source.split(/\r?\n/), 0)).toEqual({ contents: 'read' });
  });

  it('gives contents:write only to the job that creates the release', () => {
    for (const job of jobNames(source)) {
      const write = effectivePermissions(source, job)['contents'] === 'write';
      expect(write, `job ${job}`).toBe(job === 'github-release');
    }
  });

  it('refuses the scalar permissions form instead of reporting none', () => {
    // Both levels, because the hole existed at both and only the workflow-level
    // one happened to be caught by an unrelated assertion.
    const jobScalar = ['jobs:', '  loose:', '    permissions: write-all', '    steps:', ''].join(
      '\n',
    );
    expect(() => effectivePermissions(jobScalar, 'loose')).toThrow(/unmodelled permissions shape/);

    const workflowScalar = [
      'permissions: write-all',
      '',
      'jobs:',
      '  plain:',
      '    steps:',
      '',
    ].join('\n');
    expect(() => effectivePermissions(workflowScalar, 'plain')).toThrow(
      /unmodelled permissions shape/,
    );
  });

  it('parses a synthetic workflow it does not control', () => {
    // Verifies the PARSER, not the workflow: two jobs, one inheriting and one
    // overriding, with an answer known in advance and independent of release.yml.
    const fake = [
      'permissions:',
      '  contents: read',
      '',
      'jobs:',
      '  inherits:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo hi',
      '  overrides:',
      '    # a comment inside the job, which must not be read as a key',
      '    permissions:',
      '      contents: write',
      '      id-token: write',
      '    steps:',
      '      - run: echo hi',
      '',
    ].join('\n');
    expect(jobNames(fake).sort()).toEqual(['inherits', 'overrides']);
    // Inherits the workflow-level set, and gets NO id-token from it.
    expect(effectivePermissions(fake, 'inherits')).toEqual({ contents: 'read' });
    // Replaces it wholesale rather than merging.
    expect(effectivePermissions(fake, 'overrides')).toEqual({
      contents: 'write',
      'id-token': 'write',
    });
  });
});
