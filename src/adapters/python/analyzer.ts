// src/adapters/python/analyzer.ts
import { execa } from 'execa';
import { InMemoryImportGraph } from '../../analysis/import-graph.js';
import { InMemoryCallGraph } from '../../analysis/call-graph.js';
import type { ImportGraph, CallGraph } from '../interface.js';
import type { CodeIssue } from '../../core/models.js';
import path from 'path';

export async function buildPythonImportGraph(projectRoot: string): Promise<ImportGraph> {
  const graph = new InMemoryImportGraph();

  try {
    const script = `
import ast, os, sys
root = sys.argv[1]
for dirpath, _, files in os.walk(root):
    for f in files:
        if f.endswith('.py'):
            filepath = os.path.join(dirpath, f)
            try:
                tree = ast.parse(open(filepath).read())
                for node in ast.walk(tree):
                    if isinstance(node, ast.ImportFrom) and node.module:
                        print(node.module + '|' + filepath)
            except Exception:
                pass
`;
    const result = await execa('python3', ['-c', script, projectRoot], {
      timeout: 30_000,
    });
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      const pipeIdx = line.indexOf('|');
      if (pipeIdx < 0) continue;
      const importedMod = line.slice(0, pipeIdx);
      const importingFile = line.slice(pipeIdx + 1);
      if (importedMod && importingFile) {
        const possiblePath = path.join(projectRoot, importedMod.replace(/\./g, '/') + '.py');
        graph.addEdge(possiblePath, importingFile);
      }
    }
  } catch {
    // python3 not available or script failed — return empty graph
  }

  return graph;
}

export async function buildPythonCallGraph(_files: string[]): Promise<CallGraph> {
  return new InMemoryCallGraph();
}

export async function analyzePythonFiles(_files: string[]): Promise<CodeIssue[]> {
  return [];
}
