// src/analysis/analyzers/dependencies.ts
import type { AnalyzerConfig } from '../../core/config.js';
import { BaseAnalyzer, type AnalyzerResult } from './base.js';

export class DependenciesAnalyzer extends BaseAnalyzer {
  readonly name = 'dependencies';
  readonly rulePrefix = 'DEP';

  async analyze(filePath: string, code: string, _config: AnalyzerConfig): Promise<AnalyzerResult> {
    const issues: AnalyzerResult['issues'] = [];
    const lines = code.split('\n');
    const importedNames: { name: string; line: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      const pyImport = line.match(/^import\s+(\w+)|^from\s+\S+\s+import\s+(\w+)/);
      if (pyImport) {
        const name = pyImport[1] ?? pyImport[2] ?? '';
        if (name) importedNames.push({ name, line: i + 1 });
      }

      const tsImport = line.match(/^import\s*\{([^}]+)\}/);
      if (tsImport) {
        const names = tsImport[1]?.split(',').map((s) => s.trim()) ?? [];
        for (const name of names) {
          if (name) importedNames.push({ name, line: i + 1 });
        }
      }
    }

    const fullCode = lines.join('\n');
    for (const { name, line } of importedNames) {
      const occurrences = (fullCode.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
      if (occurrences <= 1) {
        issues.push({
          id: this.makeIssueId(filePath, line, 'unused-import'),
          file: filePath,
          line,
          severity: 'low',
          type: 'unused-import',
          message: `'${name}' is imported but never used`,
          fixable: true,
          fixerName: 'unused-imports',
          ruleId: 'DEP001',
        });
      }
    }

    return { issues };
  }
}
