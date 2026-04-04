// src/analysis/analyzers/complexity.ts
import type { AnalyzerConfig } from '../../core/config.js';
import { BaseAnalyzer, type AnalyzerResult } from './base.js';

export class ComplexityAnalyzer extends BaseAnalyzer {
  readonly name = 'complexity';
  readonly rulePrefix = 'CMP';

  async analyze(filePath: string, code: string, config: AnalyzerConfig): Promise<AnalyzerResult> {
    const threshold = config.threshold ?? 10;
    const issues: AnalyzerResult['issues'] = [];
    const lines = code.split('\n');
    const BRANCH_KEYWORDS = /\b(if|elif|else|for|while|except|case|and|or)\b/g;

    let inFunction = false;
    let functionStart = 0;
    let functionName = '';
    let complexity = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const fnMatch = line.match(/^\s*(?:def|function|async\s+function)\s+(\w+)/);
      if (fnMatch) {
        if (inFunction && complexity > threshold) {
          issues.push({
            id: this.makeIssueId(filePath, functionStart, 'high-complexity'),
            file: filePath,
            line: functionStart,
            severity: complexity > threshold * 2 ? 'critical' : 'high',
            type: 'high-complexity',
            message: `Function '${functionName}' has cyclomatic complexity ${complexity} (threshold: ${threshold})`,
            suggestion: 'Extract sub-functions to reduce complexity',
            fixable: false,
            ruleId: 'CMP001',
          });
        }
        inFunction = true;
        functionStart = i + 1;
        functionName = fnMatch[1] ?? '';
        complexity = 1;
      } else if (inFunction) {
        BRANCH_KEYWORDS.lastIndex = 0;
        const matches = line.match(BRANCH_KEYWORDS);
        if (matches) complexity += matches.length;
      }
    }

    if (inFunction && complexity > threshold) {
      issues.push({
        id: this.makeIssueId(filePath, functionStart, 'high-complexity'),
        file: filePath,
        line: functionStart,
        severity: 'high',
        type: 'high-complexity',
        message: `Function '${functionName}' has cyclomatic complexity ${complexity} (threshold: ${threshold})`,
        suggestion: 'Extract sub-functions',
        fixable: false,
        ruleId: 'CMP001',
      });
    }

    return { issues };
  }
}
