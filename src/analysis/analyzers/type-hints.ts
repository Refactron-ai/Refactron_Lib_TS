// src/analysis/analyzers/type-hints.ts
import type { AnalyzerConfig } from '../../core/config.js';
import { BaseAnalyzer, type AnalyzerResult } from './base.js';

export class TypeHintsAnalyzer extends BaseAnalyzer {
  readonly name = 'type_hints';
  readonly rulePrefix = 'TYP';

  async analyze(filePath: string, code: string, _config: AnalyzerConfig): Promise<AnalyzerResult> {
    const issues: AnalyzerResult['issues'] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      if (filePath.endsWith('.py')) {
        if (
          /^\s*def\s+\w+\s*\([^)]*\)\s*:/.test(line) &&
          !/^\s*def\s+\w+\s*\([^)]*\)\s*->/.test(line)
        ) {
          const fnName = line.match(/def\s+(\w+)/)?.[1] ?? 'unknown';
          issues.push({
            id: this.makeIssueId(filePath, i + 1, 'missing-return-type'),
            file: filePath,
            line: i + 1,
            severity: 'low',
            type: 'missing-return-type',
            message: `Function '${fnName}' missing return type annotation`,
            fixable: true,
            fixerName: 'type-hints',
            ruleId: 'TYP001',
          });
        }
      }

      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        if (/:\s*any\b/.test(line)) {
          issues.push({
            id: this.makeIssueId(filePath, i + 1, 'explicit-any'),
            file: filePath,
            line: i + 1,
            severity: 'high',
            type: 'explicit-any',
            message: 'Explicit any type — use a specific type instead',
            fixable: false,
            ruleId: 'TYP002',
          });
        }
      }
    }

    return { issues };
  }
}
