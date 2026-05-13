import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/callback-to-async.js';

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
