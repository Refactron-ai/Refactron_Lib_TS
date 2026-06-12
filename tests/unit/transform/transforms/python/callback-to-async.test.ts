import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/callback-to-async.js';
import { buildCrossFileContext } from '../../../../../src/transform/cross-file.js';
import type { ExtendedAnalysisReport } from '../../../../../src/analyze/engine.js';
import type { CrossFileContext } from '../../../../../src/transform/types.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't1-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

describe('callback_to_async_await (python)', () => {
  it('converts simple trailing-callback function', async () => {
    const src = 'def fetch(url, callback):\n    result = url.upper()\n    callback(result)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toContain('async def fetch(url):');
    expect(r.newContent).toContain('return result');
    expect(r.newContent).not.toContain('callback');
  });

  it('handles cb alias', async () => {
    const src = 'def save(x, cb):\n    y = process(x)\n    cb(y)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toContain('async def save(x):');
    expect(r.newContent).toContain('return y');
  });

  it('handles done alias', async () => {
    const src = 'def write(x, done):\n    done(x)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toContain('async def write(x):');
  });

  it('preserves preceding decorators and type hints', async () => {
    const src = '@retry\ndef get(url: str, callback):\n    callback(url)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toContain('@retry');
    expect(r.newContent).toContain('async def get(url: str):');
  });

  it('precondition fails: callback is not the last param', async () => {
    const src = 'def f(callback, x):\n    callback(x)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some((c) => !c.satisfied && /last positional/.test(c.reason ?? '')),
    ).toBe(true);
  });

  it('precondition fails: function is a generator', async () => {
    const src = 'def f(x, callback):\n    yield x\n    callback(x)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => !c.satisfied && /generator/.test(c.reason ?? ''))).toBe(
      true,
    );
  });

  it('precondition fails: callback called more than once', async () => {
    const src = 'def f(x, callback):\n    callback(x)\n    callback(x)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => !c.satisfied && /exactly once/.test(c.reason ?? ''))).toBe(
      true,
    );
  });

  it('precondition fails: already async', async () => {
    const src = 'async def f(x, callback):\n    callback(x)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });
});

async function projectWithCallers(
  callerSource: string,
): Promise<{ src: string; ctx: CrossFileContext }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 't1-xf-'));
  await fs.writeFile(
    path.join(root, 'callbacks.py'),
    'def fetch(url, callback):\n    callback(url)\n',
  );
  await fs.writeFile(path.join(root, 'test_caller.py'), callerSource);
  const report: ExtendedAnalysisReport = {
    root,
    findings: [],
    analyzedAt: new Date(),
    importGraph: new Map([
      ['callbacks.py', new Set<string>()],
      ['test_caller.py', new Set<string>(['callbacks.py'])],
    ]),
    callEdges: [],
  };
  const cf = await buildCrossFileContext(report, root);
  return { src: path.join(root, 'callbacks.py'), ctx: cf };
}

describe('python: callback_to_async_await — cross-file', () => {
  it('skips when an external file calls <module>.<fn> with the callback arg', async () => {
    const { src, ctx } = await projectWithCallers(
      'import callbacks\nimport unittest.mock\ndef cb(x): pass\ncallbacks.fetch("u", cb)\n',
    );
    const source = await fs.readFile(src, 'utf8');
    const r = await transform({
      absPath: src,
      relPath: 'callbacks.py',
      source,
      findings: [],
      crossFile: ctx,
    });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some(
        (p) => !p.satisfied && /external/.test(p.reason ?? '') && /fetch/.test(p.id),
      ),
    ).toBe(true);
  });

  it('skips when an external file uses from-import then calls fn(...)', async () => {
    const { src, ctx } = await projectWithCallers(
      'from callbacks import fetch\ndef cb(x): pass\nfetch("u", cb)\n',
    );
    const source = await fs.readFile(src, 'utf8');
    const r = await transform({
      absPath: src,
      relPath: 'callbacks.py',
      source,
      findings: [],
      crossFile: ctx,
    });
    expect(r.newContent).toBeNull();
  });

  it('proceeds when no external callers exist', async () => {
    const { src, ctx } = await projectWithCallers('# no callers\n');
    const source = await fs.readFile(src, 'utf8');
    const r = await transform({
      absPath: src,
      relPath: 'callbacks.py',
      source,
      findings: [],
      crossFile: ctx,
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('async def fetch');
  });

  it('emits a precondition record when no callback pattern is reachable (Bug #3)', async () => {
    // No trailing `callback` / `cb` / `done` parameter anywhere in the file
    // — previously the sidecar returned an empty precondition list, hiding
    // the analyze->run gap from users.
    const src = 'def f(x, y):\n    return x + y\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some((c) => c.id === 'no_callback_pattern_matched' && !c.satisfied),
    ).toBe(true);
  });
});
