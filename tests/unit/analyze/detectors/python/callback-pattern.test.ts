import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/callback-pattern.js';

function ctx(source: string) {
  return { absPath: '/x/a.py', relPath: 'a.py', source, tree: parsePython(source) };
}

describe('python: callback-pattern', () => {
  it('detects trailing callback param', () => {
    const findings = detect(ctx('def fetch(url, callback):\n    callback(url)\n'));
    expect(findings.length).toBe(1);
    expect(findings[0]!.transformId).toBe('callback_to_async_await');
    expect(findings[0]!.confidence).toBe('high');
  });
  it('detects "cb" and "done" aliases', () => {
    expect(detect(ctx('def f(x, cb):\n    cb(x)\n'))).toHaveLength(1);
    expect(detect(ctx('def f(x, done):\n    done(x)\n'))).toHaveLength(1);
  });
  it('skips functions whose last param is not callback-named', () => {
    expect(detect(ctx('def f(x, y):\n    return y\n'))).toHaveLength(0);
  });
  it('skips when the callback is never called', () => {
    expect(detect(ctx('def f(x, callback):\n    return x\n'))).toHaveLength(0);
  });
  it('low confidence when callback called in non-trailing position', () => {
    const findings = detect(ctx('def f(x, callback):\n    callback(x)\n    return 1\n'));
    expect(findings[0]!.confidence).toBe('medium');
  });
});
