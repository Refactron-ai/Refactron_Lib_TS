// tests/unit/release/publish-job-hardening.test.ts
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
