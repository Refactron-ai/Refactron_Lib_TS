// src/analysis/blast-radius.ts
import type { BlastRadius, BlastLevel } from '../core/models.js';
import type { ImportGraph, CallGraph } from '../adapters/interface.js';

export class BlastRadiusAnalyzer {
  constructor(
    private callGraph: CallGraph,
    private importGraph: ImportGraph,
  ) {}

  compute(targetFile: string, targetFunction?: string): BlastRadius {
    // 1. Direct dependents
    const directDependents = this.importGraph.dependentsOf(targetFile);

    // 2. Transitive walk
    const visited = new Set<string>([targetFile]);
    const allDependents = this.walkTransitive(directDependents, visited);

    // 3. Function-level analysis
    const affectedFunctions = targetFunction
      ? this.callGraph.transitiveCallersOf(targetFile, targetFunction)
      : this.callGraph.allPublicFunctionsIn([targetFile, ...allDependents]);

    // 4. Test files only
    const affectedTestFiles = [...allDependents].filter((f) => this.isTestFile(f));

    // 5. Score 0–100
    const score = this.score(
      allDependents.size,
      affectedFunctions.length,
      affectedTestFiles.length,
    );

    return {
      affectedFiles: [...allDependents],
      affectedFunctions,
      affectedTestFiles,
      score,
      level: this.levelFromScore(score),
    };
  }

  private walkTransitive(files: string[], visited: Set<string>): Set<string> {
    const result = new Set<string>();
    const queue = [...files];

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);
      result.add(file);

      const nextLevel = this.importGraph.dependentsOf(file);
      queue.push(...nextLevel.filter((f) => !visited.has(f)));
    }

    return result;
  }

  private score(files: number, fns: number, tests: number): number {
    // Weighted: files 40%, functions 40%, test coverage gap 20%
    const fileScore = Math.min(files / 50, 1) * 40;
    const fnScore = Math.min(fns / 100, 1) * 40;
    const testGap = tests === 0 && files > 0 ? 20 : 0;
    return Math.round(fileScore + fnScore + testGap);
  }

  private levelFromScore(score: number): BlastLevel {
    if (score === 0) return 'trivial';
    if (score < 20) return 'low';
    if (score < 50) return 'medium';
    if (score < 75) return 'high';
    return 'critical';
  }

  private isTestFile(file: string): boolean {
    return (
      file.includes('/tests/') ||
      file.includes('/test/') ||
      file.includes('__tests__') ||
      /\.(test|spec)\.(ts|js|py)$/.test(file) ||
      /^test_/.test(file.split('/').pop() ?? '')
    );
  }
}
