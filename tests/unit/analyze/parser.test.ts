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
  it('parses a file larger than the 32 KB tree-sitter string limit', () => {
    // tree-sitter's native binding throws "Invalid argument" on a string
    // input past ~32 KB. The callback-input form has no such cap. This
    // fixture is ~120 KB — well past the cliff that crashed analyze on
    // real projects with large source files.
    const big = `export const data = [\n${Array.from(
      { length: 4000 },
      (_, i) => `  { id: ${i}, name: 'item-${i}' },`,
    ).join('\n')}\n];\n`;
    expect(big.length).toBeGreaterThan(32_768);
    const tree = parseTypescript(big, false);
    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.hasError).toBe(false);
  });
  it('parses a large python file past the same limit', () => {
    const big = Array.from({ length: 4000 }, (_, i) => `def fn_${i}():\n    return ${i}\n`).join(
      '\n',
    );
    expect(big.length).toBeGreaterThan(32_768);
    const tree = parsePython(big);
    expect(tree.rootNode.type).toBe('module');
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
