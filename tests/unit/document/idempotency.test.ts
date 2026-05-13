import { describe, it, expect } from 'vitest';
import { hasExistingDocstring } from '../../../src/document/idempotency.js';

describe('hasExistingDocstring — python', () => {
  it('returns true when first body line is a triple-quoted docstring', () => {
    const src = `def f(x):\n    """Do a thing."""\n    return x\n`;
    expect(hasExistingDocstring('python', 'f', src)).toBe(true);
  });

  it('returns false when there is no docstring', () => {
    const src = `def f(x):\n    return x\n`;
    expect(hasExistingDocstring('python', 'f', src)).toBe(false);
  });

  it('returns true for single-quote triple docstrings', () => {
    const src = `def g():\n    '''doc'''\n    pass\n`;
    expect(hasExistingDocstring('python', 'g', src)).toBe(true);
  });

  it('returns true for single-line single-quoted string body', () => {
    const src = `def h():\n    "doc"\n    return 1\n`;
    expect(hasExistingDocstring('python', 'h', src)).toBe(true);
  });

  it('skips blank lines between def header and body', () => {
    const src = `def k(x):\n\n    """doc"""\n    return x\n`;
    expect(hasExistingDocstring('python', 'k', src)).toBe(true);
  });

  it('finds the right symbol when multiple defs exist', () => {
    const src = `def a():\n    """A doc."""\n    return 1\n\ndef b():\n    return 2\n`;
    expect(hasExistingDocstring('python', 'b', src)).toBe(false);
    expect(hasExistingDocstring('python', 'a', src)).toBe(true);
  });

  it('returns false when symbol does not exist', () => {
    const src = `def f(x):\n    """doc"""\n    return x\n`;
    expect(hasExistingDocstring('python', 'missing', src)).toBe(false);
  });

  it('handles async def', () => {
    const src = `async def fetch():\n    """fetches."""\n    return 1\n`;
    expect(hasExistingDocstring('python', 'fetch', src)).toBe(true);
  });

  it('handles class definitions', () => {
    const src = `class C:\n    """class doc."""\n    pass\n`;
    expect(hasExistingDocstring('python', 'C', src)).toBe(true);
  });
});

describe('hasExistingDocstring — typescript', () => {
  it('returns true when a JSDoc block precedes the function', () => {
    const src = `/** A function. */\nfunction f(x: number) { return x; }\n`;
    expect(hasExistingDocstring('typescript', 'f', src)).toBe(true);
  });

  it('returns false when there is no JSDoc', () => {
    const src = `function f(x: number) { return x; }\n`;
    expect(hasExistingDocstring('typescript', 'f', src)).toBe(false);
  });

  it('returns true for multi-line JSDoc above the declaration', () => {
    const src = `/**\n * Multi-line doc.\n */\nfunction g() { return 1; }\n`;
    expect(hasExistingDocstring('typescript', 'g', src)).toBe(true);
  });

  it('skips blank lines between JSDoc close and declaration', () => {
    const src = `/** doc */\n\nfunction h() { return 1; }\n`;
    expect(hasExistingDocstring('typescript', 'h', src)).toBe(true);
  });

  it('returns false for a bare // comment above the function', () => {
    const src = `// just a comment\nfunction f() { return 1; }\n`;
    expect(hasExistingDocstring('typescript', 'f', src)).toBe(false);
  });

  it('handles exported async function', () => {
    const src = `/** doc */\nexport async function fetchIt() { return 1; }\n`;
    expect(hasExistingDocstring('typescript', 'fetchIt', src)).toBe(true);
  });

  it('handles class declarations', () => {
    const src = `/** doc */\nexport class Foo {}\n`;
    expect(hasExistingDocstring('typescript', 'Foo', src)).toBe(true);
  });

  it('handles arrow-function consts', () => {
    const src = `/** doc */\nexport const handler = (x: number) => x;\n`;
    expect(hasExistingDocstring('typescript', 'handler', src)).toBe(true);
  });

  it('returns false when the named symbol is missing', () => {
    const src = `/** doc */\nfunction other() {}\n`;
    expect(hasExistingDocstring('typescript', 'missing', src)).toBe(false);
  });
});
