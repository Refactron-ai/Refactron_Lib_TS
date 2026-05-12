import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../src/analyze/parser.js';
import { extractCallEdges } from '../../../../src/analyze/graphs/call-graph.js';

describe('call-graph', () => {
  it('records calls inside a function', () => {
    const source = 'def a():\n    b()\n    c()\n';
    const tree = parsePython(source);
    const edges = extractCallEdges('python', 'x.py', source, tree);
    expect(edges).toContainEqual({ caller: 'a', callee: 'b', file: 'x.py' });
    expect(edges).toContainEqual({ caller: 'a', callee: 'c', file: 'x.py' });
  });
});
