import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { testsGate, baselineFailReason } from '../../../src/verify/gates/tests.js';
import { createShadowTree } from '../../../src/verify/shadow-tree.js';

async function fixtureWithPassingTest(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-'));
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[tool.pytest.ini_options]\ntestpaths = ["."]\npythonpath = ["."]\n',
  );
  await fs.writeFile(path.join(root, 'lib.py'), 'def x(): return 1\n');
  await fs.writeFile(
    path.join(root, 'test_lib.py'),
    'from lib import x\ndef test_ok(): assert x() == 1\n',
  );
  return root;
}

// A pytest project whose one test FAILS on its first execution in a given tree
// and PASSES on every subsequent execution, driven by a cwd-relative marker
// file. runRunner sets cwd to the shadow root, and the gate's retry reuses that
// same shadow, so the marker persists across the retry: a deterministic flake.
async function fixtureWithFlakyTest(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-flaky-'));
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[tool.pytest.ini_options]\ntestpaths = ["."]\npythonpath = ["."]\n',
  );
  await fs.writeFile(
    path.join(root, 'test_flaky.py'),
    [
      'import os',
      '',
      'def test_flaky():',
      '    marker = os.path.join(os.getcwd(), ".flake_marker")',
      '    if not os.path.exists(marker):',
      '        open(marker, "w").close()',
      '        raise AssertionError("flaky: first run in this tree fails")',
      '    assert True',
      '',
    ].join('\n'),
  );
  return root;
}

describe('testsGate', () => {
  it('passes when shadow tree tests pass', async () => {
    const root = await fixtureWithPassingTest();
    const h = await createShadowTree(root, []);
    const r = await testsGate({ shadowRoot: h.path, changes: [] }, root, {});
    await h.cleanup();
    expect(r.passed).toBe(true);
  }, 60_000);

  it('fails when a change breaks behavior', async () => {
    const root = await fixtureWithPassingTest();
    const change = {
      path: path.join(root, 'lib.py'),
      oldHash: 'x',
      newContent: 'def x(): return 2\n',
      transformId: 'format_to_fstring' as const,
    };
    const h = await createShadowTree(root, [change]);
    const r = await testsGate({ shadowRoot: h.path, changes: [change] }, root, {});
    await h.cleanup();
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toBeTruthy();
  }, 60_000);

  it('aborts with a clear message if baseline already fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-bf-'));
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      '[tool.pytest.ini_options]\ntestpaths = ["."]\npythonpath = ["."]\n',
    );
    await fs.writeFile(path.join(root, 'test_x.py'), 'def test_fail(): assert False\n');
    const h = await createShadowTree(root, []);
    const r = await testsGate({ shadowRoot: h.path, changes: [] }, root, {});
    await h.cleanup();
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/baseline/i);
  }, 60_000);

  it('preserves the baseline-fail marker even with large output (no tail truncation of prefix)', () => {
    const reason = baselineFailReason('x'.repeat(10000), 'x'.repeat(10000));
    expect(reason).toContain('baseline tests already fail');
  });

  // (a) A new failure that vanishes when the same shadow is rerun is flaky, not
  // a regression. The gate must pass and surface the id as a flaky suspect.
  it('treats a new failure that heals on retry as flaky (gate passes, id surfaced)', async () => {
    const root = await fixtureWithFlakyTest();
    const h = await createShadowTree(root, []);
    const r = await testsGate({ shadowRoot: h.path, changes: [] }, root, {});
    await h.cleanup();
    expect(r.passed).toBe(true);
    expect(r.flakySuspects).toContain('test_flaky.py::test_flaky');
  }, 60_000);

  // (b) A new failure that persists on retry is a genuine regression: the gate
  // must still fail, still surface the failing tail, and never flag it flaky.
  it('fails when a new failure persists on retry (genuine regression, not flaky)', async () => {
    const root = await fixtureWithPassingTest();
    const change = {
      path: path.join(root, 'lib.py'),
      oldHash: 'x',
      newContent: 'def x(): return 2\n',
      transformId: 'format_to_fstring' as const,
    };
    const h = await createShadowTree(root, [change]);
    const r = await testsGate({ shadowRoot: h.path, changes: [change] }, root, {});
    await h.cleanup();
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/tests fail after refactoring/);
    expect(r.flakySuspects ?? []).toEqual([]);
  }, 60_000);

  // (d) When a non-zero run yields output we cannot parse into a failure set, we
  // must NOT get lenient: behave exactly as today (any failure fails the gate).
  it('falls back to a plain failure when the runner output is unparseable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-unparseable-'));
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
    const h = await createShadowTree(root, []);
    const r = await testsGate({ shadowRoot: h.path, changes: [] }, root, {
      skipBaseline: true,
      testCmd: 'echo boom-unparseable-no-failed-lines; exit 1',
    });
    await h.cleanup();
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toBeTruthy();
    expect(r.flakySuspects ?? []).toEqual([]);
  }, 60_000);
});
