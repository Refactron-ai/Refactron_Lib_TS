import { describe, it, expect } from 'vitest';
import { parseBatchDocstrings } from '../../../src/document/engine.js';
import { batchDocstringPrompt } from '../../../src/document/prompts.js';

describe('parseBatchDocstrings', () => {
  it('parses a strict-JSON object keyed by integer tag', () => {
    const m = parseBatchDocstrings('{"0":"first","1":"second"}');
    expect(m.get(0)).toBe('first');
    expect(m.get(1)).toBe('second');
  });

  it('salvages valid entries and skips non-string values', () => {
    const m = parseBatchDocstrings('{"0":"ok","1":42,"2":"also ok"}');
    expect(m.get(0)).toBe('ok');
    expect(m.has(1)).toBe(false);
    expect(m.get(2)).toBe('also ok');
  });

  it('returns an empty map for unparseable or non-object input', () => {
    expect(parseBatchDocstrings('not json').size).toBe(0);
    expect(parseBatchDocstrings('[1,2,3]').size).toBe(0);
  });

  it('salvages complete pairs from a response truncated mid-object', () => {
    // The model hit its completion cap mid-string on tag 2.
    const truncated = '{\n  "0": "first body",\n  "1": "second body",\n  "2": "third body is cut o';
    const m = parseBatchDocstrings(truncated);
    expect(m.get(0)).toBe('first body');
    expect(m.get(1)).toBe('second body');
    expect(m.has(2)).toBe(false);
  });

  it('salvages pairs whose values contain escaped quotes and newlines', () => {
    const truncated = '{"0":"line one\\nline two","1":"has \\"quotes\\" inside","2":"cut';
    const m = parseBatchDocstrings(truncated);
    expect(m.get(0)).toBe('line one\nline two');
    expect(m.get(1)).toBe('has "quotes" inside');
    expect(m.has(2)).toBe(false);
  });
});

describe('batchDocstringPrompt', () => {
  it('numbers each symbol by tag and asks for strict JSON', () => {
    const p = batchDocstringPrompt([
      { tag: 0, symbol: 'foo', kind: 'function', language: 'python', source: 'def foo(): pass' },
      { tag: 1, symbol: 'Bar', kind: 'class', language: 'typescript', source: 'class Bar {}' },
    ]);
    expect(p).toContain('[REFACTRON:DOCSTRING-BATCH]');
    expect(p).toContain('### tag 0 — foo (function, python)');
    expect(p).toContain('### tag 1 — Bar (class, typescript)');
    expect(p).toContain('STRICT JSON');
  });
});
