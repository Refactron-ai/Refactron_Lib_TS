// tests/unit/blast-radius.test.ts
import { describe, it, expect } from 'vitest';
import { BlastRadiusAnalyzer } from '../../src/analysis/blast-radius.js';
import { InMemoryImportGraph } from '../../src/analysis/import-graph.js';
import { InMemoryCallGraph } from '../../src/analysis/call-graph.js';

describe('BlastRadiusAnalyzer', () => {
  it('returns trivial blast for isolated file', () => {
    const analyzer = new BlastRadiusAnalyzer(new InMemoryCallGraph(), new InMemoryImportGraph());
    const blast = analyzer.compute('isolated.py');
    expect(blast.level).toBe('trivial');
    expect(blast.score).toBe(0);
    expect(blast.affectedFiles).toHaveLength(0);
  });

  it('returns higher score for widely-imported file', () => {
    const importGraph = new InMemoryImportGraph();
    for (let i = 0; i < 30; i++) {
      importGraph.addEdge('utils.py', `file${i}.py`);
    }
    const analyzer = new BlastRadiusAnalyzer(new InMemoryCallGraph(), importGraph);
    const blast = analyzer.compute('utils.py');
    expect(blast.score).toBeGreaterThan(20);
    expect(['medium', 'high', 'critical']).toContain(blast.level);
    expect(blast.affectedFiles.length).toBe(30);
  });

  it('adds 20 point test gap penalty when no test files cover affected files', () => {
    const importGraph = new InMemoryImportGraph();
    for (let i = 0; i < 5; i++) {
      importGraph.addEdge('core.py', `module${i}.py`);
    }
    const analyzer = new BlastRadiusAnalyzer(new InMemoryCallGraph(), importGraph);
    const blast = analyzer.compute('core.py');
    // 5 files: (5/50)*40 = 4, 0 fns, test gap 20 = 24
    expect(blast.score).toBe(24);
  });

  it('does not apply test gap penalty when test files exist', () => {
    const importGraph = new InMemoryImportGraph();
    importGraph.addEdge('core.py', 'module.py');
    importGraph.addEdge('core.py', 'tests/test_core.py');
    const analyzer = new BlastRadiusAnalyzer(new InMemoryCallGraph(), importGraph);
    const blast = analyzer.compute('core.py');
    expect(blast.affectedTestFiles).toContain('tests/test_core.py');
    // test gap = 0 because a test file exists
    // 2 files: (2/50)*40 = 1.6 → round = 2, no test gap
    expect(blast.score).toBe(2);
  });

  it('maps score 0 to trivial, 82 to critical', () => {
    const importGraph = new InMemoryImportGraph();
    for (let i = 0; i < 50; i++) importGraph.addEdge('core.py', `file${i}.py`);
    const callGraph = new InMemoryCallGraph();
    callGraph.setPublicFunctions(
      'core.py',
      Array.from({ length: 100 }, (_, i) => `fn${i}`),
    );
    const analyzer = new BlastRadiusAnalyzer(callGraph, importGraph);
    const blast = analyzer.compute('core.py');
    expect(blast.level).toBe('critical');
  });
});
