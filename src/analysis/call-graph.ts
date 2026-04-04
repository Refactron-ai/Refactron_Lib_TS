// src/analysis/call-graph.ts
import type { CallGraph } from '../adapters/interface.js';

export class InMemoryCallGraph implements CallGraph {
  // callers[file::fn] = set of "file::fn" strings that call it
  private callers = new Map<string, Set<string>>();
  // publicFunctions[file] = list of exported function names
  private publicFunctions = new Map<string, string[]>();

  addCall(calledFile: string, calledFn: string, callerFile: string, callerFn: string): void {
    const key = `${calledFile}::${calledFn}`;
    if (!this.callers.has(key)) this.callers.set(key, new Set());
    this.callers.get(key)!.add(`${callerFile}::${callerFn}`);
  }

  setPublicFunctions(file: string, fns: string[]): void {
    this.publicFunctions.set(file, fns);
  }

  transitiveCallersOf(file: string, fn: string): string[] {
    const result = new Set<string>();
    const queue = [`${file}::${fn}`];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const directCallers = [...(this.callers.get(current) ?? [])];
      for (const caller of directCallers) {
        if (!result.has(caller)) {
          result.add(caller);
          queue.push(caller);
        }
      }
    }

    return [...result];
  }

  allPublicFunctionsIn(files: string[]): string[] {
    const result: string[] = [];
    for (const file of files) {
      const fns = this.publicFunctions.get(file) ?? [];
      result.push(...fns.map((fn) => `${file}::${fn}`));
    }
    return result;
  }
}
