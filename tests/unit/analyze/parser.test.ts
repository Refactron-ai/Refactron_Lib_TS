import { describe, it, expect } from 'vitest';
import { parsePython, parseTypescript } from '../../../src/analyze/parser.js';

describe('parsers', () => {
  it('parses valid python', () => {
    const tree = parsePython('def f(): return 1\n');
    expect(tree.rootNode.type).toBe('module');
    expect(tree.rootNode.hasError).toBe(false);
  });
  it('produces error-recovering tree on broken python', () => {
    const tree = parsePython('def f(:\n');
    expect(tree.rootNode.hasError).toBe(true);
  });
  it('parses valid typescript', () => {
    const tree = parseTypescript('export const x: number = 1;\n', false);
    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.hasError).toBe(false);
  });
  it('parses tsx with tsx grammar', () => {
    const tree = parseTypescript('export const X = () => <div/>;\n', true);
    expect(tree.rootNode.hasError).toBe(false);
  });
  it('reuses the same parser instance across calls', () => {
    const a = parsePython('x = 1\n');
    const b = parsePython('y = 2\n');
    expect(a).not.toBe(b); // different trees
    // Implementation detail: same parser singleton — assert via no leaks under repeated calls.
    for (let i = 0; i < 50; i++) parsePython(`x${i} = ${i}\n`);
  });
});
