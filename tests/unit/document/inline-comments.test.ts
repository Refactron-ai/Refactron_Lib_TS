import { describe, it, expect } from 'vitest';
import {
  numberSource,
  parseRawComments,
  resolveComments,
} from '../../../src/document/inline-comments.js';

describe('numberSource', () => {
  it('prefixes each line with a 1-indexed NNN| marker', () => {
    const out = numberSource('def f():\n    return 1');
    expect(out).toContain('1| def f():');
    expect(out).toContain('2|     return 1');
  });
});

describe('parseRawComments', () => {
  it('parses a well-formed JSON array', () => {
    const raw = JSON.stringify([
      { line: 2, anchorContent: 'return 1', occurrence: 1, comment: ['Why one'] },
    ]);
    const out = parseRawComments(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.anchorContent).toBe('return 1');
  });

  it('discards malformed items but keeps valid ones', () => {
    const raw = JSON.stringify([
      { line: 'nope', anchorContent: 'x', comment: ['y'] },
      { line: 3, anchorContent: 'ok', comment: ['good'] },
    ]);
    expect(parseRawComments(raw)).toHaveLength(1);
  });

  it('returns [] for non-array or unparseable input', () => {
    expect(parseRawComments('not json')).toEqual([]);
    expect(parseRawComments('{"line":1}')).toEqual([]);
  });

  it('tolerates a stray code fence', () => {
    const raw = '```json\n[{"line":1,"anchorContent":"a","comment":["c"]}]\n```';
    expect(parseRawComments(raw)).toHaveLength(1);
  });
});

describe('resolveComments', () => {
  const source = 'def f(x):\n    y = x * 2\n    return y\n';

  it('resolves an exact anchor and indents the comment', () => {
    const { insertions, dropped } = resolveComments('python', source, [
      { line: 2, anchorContent: 'y = x * 2', occurrence: 1, comment: ['Double the input'] },
    ]);
    expect(dropped).toBe(0);
    expect(insertions).toHaveLength(1);
    expect(insertions[0]?.line).toBe(2);
    expect(insertions[0]?.lines).toEqual(['    # Double the input']);
  });

  it('resolves an anchor that drifted within the window', () => {
    // hint says line 4 but the anchor text is really on line 3.
    const { insertions, dropped } = resolveComments('python', source, [
      { line: 4, anchorContent: 'return y', occurrence: 1, comment: ['Result'] },
    ]);
    expect(dropped).toBe(0);
    expect(insertions[0]?.line).toBe(3);
  });

  it('drops a comment whose anchor has no match', () => {
    const { insertions, dropped } = resolveComments('python', source, [
      { line: 2, anchorContent: 'no such line', occurrence: 1, comment: ['x'] },
    ]);
    expect(insertions).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('uses // for typescript', () => {
    const ts = 'function f() {\n  return 1;\n}\n';
    const { insertions } = resolveComments('typescript', ts, [
      { line: 2, anchorContent: 'return 1;', occurrence: 1, comment: ['Done'] },
    ]);
    expect(insertions[0]?.lines).toEqual(['  // Done']);
  });

  it('skips a comment that is already present (idempotent)', () => {
    const commented = 'def f(x):\n    # Double the input\n    y = x * 2\n';
    const { insertions } = resolveComments('python', commented, [
      { line: 3, anchorContent: 'y = x * 2', occurrence: 1, comment: ['Double the input'] },
    ]);
    expect(insertions).toHaveLength(0);
  });
});
