// src/analysis/analyzers/code-smell.ts
import type { AnalyzerConfig } from '../../core/config.js';
import { BaseAnalyzer, type AnalyzerResult } from './base.js';

export class CodeSmellAnalyzer extends BaseAnalyzer {
  readonly name = 'code_smell';
  readonly rulePrefix = 'CSM';

  async analyze(filePath: string, code: string, config: AnalyzerConfig): Promise<AnalyzerResult> {
    const maxLines = config.max_method_lines ?? 50;
    const issues: AnalyzerResult['issues'] = [];
    const lines = code.split('\n');
    let fnStart = -1;
    let fnName = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const fnMatch = line.match(/^\s*(?:def|function|async\s+function)\s+(\w+)/);
      if (fnMatch) {
        if (fnStart >= 0 && i - fnStart > maxLines) {
          issues.push({
            id: this.makeIssueId(filePath, fnStart, 'long-method'),
            file: filePath,
            line: fnStart,
            severity: 'medium',
            type: 'long-method',
            message: `Function '${fnName}' is ${i - fnStart} lines (max: ${maxLines})`,
            suggestion: 'Extract smaller focused functions',
            fixable: false,
            ruleId: 'CSM001',
          });
        }
        fnStart = i + 1;
        fnName = fnMatch[1] ?? '';
      }
    }

    return { issues };
  }
}
