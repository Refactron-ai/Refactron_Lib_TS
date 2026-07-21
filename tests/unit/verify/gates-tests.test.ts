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
});
