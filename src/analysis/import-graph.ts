// src/analysis/import-graph.ts
import type { ImportGraph } from '../adapters/interface.js';

export class InMemoryImportGraph implements ImportGraph {
  // dependents[file] = set of files that import `file`
  private dependents = new Map<string, Set<string>>();
  // dependencies[file] = set of files that `file` imports
  private dependencies = new Map<string, Set<string>>();

  addEdge(importedFile: string, importingFile: string): void {
    if (!this.dependents.has(importedFile)) {
      this.dependents.set(importedFile, new Set());
    }
    this.dependents.get(importedFile)!.add(importingFile);

    if (!this.dependencies.has(importingFile)) {
      this.dependencies.set(importingFile, new Set());
    }
    this.dependencies.get(importingFile)!.add(importedFile);
  }

  dependentsOf(file: string): string[] {
    return [...(this.dependents.get(file) ?? [])];
  }

  dependenciesOf(file: string): string[] {
    return [...(this.dependencies.get(file) ?? [])];
  }

  allFiles(): string[] {
    const all = new Set([...this.dependents.keys(), ...this.dependencies.keys()]);
    return [...all];
  }
}
