// tests/unit/import-graph.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryImportGraph } from '../../src/analysis/import-graph.js';
import { InMemoryCallGraph } from '../../src/analysis/call-graph.js';

describe('InMemoryImportGraph', () => {
  it('returns direct dependents of a file', () => {
    const graph = new InMemoryImportGraph();
    graph.addEdge('a.py', 'b.py');
    graph.addEdge('a.py', 'c.py');
    expect(graph.dependentsOf('a.py')).toContain('b.py');
    expect(graph.dependentsOf('a.py')).toContain('c.py');
  });

  it('returns empty array for file with no dependents', () => {
    const graph = new InMemoryImportGraph();
    expect(graph.dependentsOf('standalone.py')).toEqual([]);
  });

  it('returns dependencies of a file', () => {
    const graph = new InMemoryImportGraph();
    graph.addEdge('utils.py', 'app.py');
    expect(graph.dependenciesOf('app.py')).toContain('utils.py');
  });

  it('allFiles returns all nodes', () => {
    const graph = new InMemoryImportGraph();
    graph.addEdge('a.py', 'b.py');
    const files = graph.allFiles();
    expect(files).toContain('a.py');
    expect(files).toContain('b.py');
  });
});

describe('InMemoryCallGraph', () => {
  it('returns transitive callers', () => {
    const graph = new InMemoryCallGraph();
    graph.addCall('utils.py', 'helper', 'app.py', 'main');
    graph.addCall('app.py', 'main', 'cli.py', 'run');
    const callers = graph.transitiveCallersOf('utils.py', 'helper');
    expect(callers).toContain('app.py::main');
    expect(callers).toContain('cli.py::run');
  });

  it('returns all public functions in files', () => {
    const graph = new InMemoryCallGraph();
    graph.setPublicFunctions('app.py', ['main', 'init']);
    const fns = graph.allPublicFunctionsIn(['app.py']);
    expect(fns).toContain('app.py::main');
    expect(fns).toContain('app.py::init');
  });
});
