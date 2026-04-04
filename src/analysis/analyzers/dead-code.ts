// src/analysis/analyzers/dead-code.ts
import type { AnalyzerConfig } from '../../core/config.js';
import { BaseAnalyzer, type AnalyzerResult } from './base.js';

export class DeadCodeAnalyzer extends BaseAnalyzer {
  readonly name = 'dead_code';
  readonly rulePrefix = 'DCO';

  async analyze(filePath: string, code: string, _config: AnalyzerConfig): Promise<AnalyzerResult> {
    const issues: AnalyzerResult['issues'] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (/^\s*(return|raise|break|continue)\b/.test(line)) {
        const next = lines[i + 1] ?? '';
        if (next.trim() && !/^\s*(#|\/\/|def |class |else:|elif |except|finally)/.test(next)) {
          issues.push({
            id: this.makeIssueId(filePath, i + 2, 'unreachable-code'),
            file: filePath,
            line: i + 2,
            severity: 'low',
            type: 'unreachable-code',
            message: 'Unreachable code after control flow statement',
            fixable: true,
            fixerName: 'dead-code',
            ruleId: 'DCO001',
          });
        }
      }
    }

    return { issues };
  }
}
