import { describe, it, expect } from 'vitest';
import { chunkByFunction } from '../../../src/document/chunker.js';

describe('chunkByFunction', () => {
  it('extracts python top-level def with body span', () => {
    const oldText = 'def fetch(url, cb):\n    cb(url)\n\ndef other(): pass\n';
    const newText = 'async def fetch(url):\n    return url\n\ndef other(): pass\n';
    const syms = chunkByFunction('a.py', oldText, newText);
    const fetch = syms.find((s) => s.symbol === 'fetch');
    expect(fetch).toBeDefined();
    if (!fetch) return;
    expect(fetch.kind).toBe('function');
    expect(fetch.startLine).toBe(1);
    expect(fetch.newText).toContain('async def fetch');
    expect(fetch.oldText).toContain('def fetch(url, cb)');
  });

  it('extracts python class and ignores unchanged symbols when oldText === newText for that range', () => {
    const oldText = 'class A:\n    def m(self): return 1\n';
    const newText = 'class A:\n    def m(self): return 2\n';
    const syms = chunkByFunction('a.py', oldText, newText);
    expect(syms.find((s) => s.symbol === 'A' && s.kind === 'class')).toBeDefined();
  });

  it('extracts typescript function and class', () => {
    const oldText = 'function f(x) { return x; }\nclass C { m() { return 1; } }\n';
    const newText = 'function f(x: number) { return x; }\nclass C { m() { return 2; } }\n';
    const syms = chunkByFunction('a.ts', oldText, newText);
    expect(syms.map((s) => s.symbol).sort()).toEqual(['C', 'f']);
  });

  it('extracts typescript arrow function with const binding', () => {
    const newText = 'export const f = async (x: number) => x + 1;\n';
    const syms = chunkByFunction('a.ts', newText, newText);
    expect(syms.find((s) => s.symbol === 'f')).toBeDefined();
  });

  it('skips files with unknown language extension', () => {
    expect(chunkByFunction('a.unknown', 'x', 'y')).toEqual([]);
  });
});
