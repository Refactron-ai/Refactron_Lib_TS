// src/analysis/analyzers/performance.ts
import type { AnalyzerConfig } from '../../core/config.js';
import { BaseAnalyzer, type AnalyzerResult } from './base.js';

export class PerformanceAnalyzer extends BaseAnalyzer {
  readonly name = 'performance';
  readonly rulePrefix = 'PER';

  async analyze(filePath: string, code: string, _config: AnalyzerConfig): Promise<AnalyzerResult> {
    const issues: AnalyzerResult['issues'] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      if (/\+\s*=\s*\[/.test(line) && /for\s/.test(lines[i - 1] ?? '')) {
        issues.push({
          id: this.makeIssueId(filePath, i + 1, 'list-concat-in-loop'),
          file: filePath,
          line: i + 1,
          severity: 'medium',
          type: 'list-concat-in-loop',
          message: 'List concatenation in loop — use append() or list comprehension',
          fixable: false,
          ruleId: 'PER001',
        });
      }

      if (/\bawait\b/.test(line) && /\bfor\b/.test(line)) {
        issues.push({
          id: this.makeIssueId(filePath, i + 1, 'await-in-loop'),
          file: filePath,
          line: i + 1,
          severity: 'medium',
          type: 'await-in-loop',
          message: 'await inside loop — use Promise.all() for parallel execution',
          fixable: false,
          ruleId: 'PER002',
        });
      }
    }

    return { issues };
  }
}
