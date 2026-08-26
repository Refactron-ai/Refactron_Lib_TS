// tests/unit/release/changelog-parity.test.ts
//
// 0.4.3 shipped to npm and PyPI with no entry on the published docs changelog.
// `CHANGELOG.md` and `docs/changelog.mdx` are two hand-maintained files with
// nothing linking them, so writing one and forgetting the other is silent: the
// release is green, the packages publish, and the docs site simply stops at the
// previous version.
//
// The version in package.json is the thing being released, so it is the anchor.
// This fails during the window between bumping the version and writing the
// entries, which is exactly when it should.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');

const version = (JSON.parse(read('package.json')) as { version: string }).version;

describe('a release is described everywhere it is published', () => {
  it('has a CHANGELOG.md section for the version in package.json', () => {
    // Escaped: the dots in a version are regex metacharacters, and an unescaped
    // pattern would match a DIFFERENT version and pass while the real section
    // was missing.
    const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm');
    expect(read('CHANGELOG.md')).toMatch(heading);
  });

  it('has a docs/changelog.mdx entry for the version in package.json', () => {
    // The one that was missed. The docs site is the changelog most users read;
    // CHANGELOG.md is the one contributors read.
    expect(read('docs/changelog.mdx')).toContain(`<Update label="${version}"`);
  });

  it('keeps the Python wrapper on the same version', () => {
    // Already enforced at tag time by validate-tag, but that runs after the
    // release is cut. Failing here costs seconds instead of a retag.
    expect(read('refactron-py/refactron/__init__.py')).toContain(`__version__ = "${version}"`);
  });

  it('did not lose the entries for versions already published', () => {
    // Guards the guard: the tests above pass if the files contain ONLY the
    // current version, which would be a docs page that silently dropped its
    // history.
    const docs = read('docs/changelog.mdx');
    for (const shipped of ['0.4.3', '0.4.2', '0.4.1', '0.4.0']) {
      expect(docs, `docs changelog is missing ${shipped}`).toContain(`<Update label="${shipped}"`);
    }
  });
});
