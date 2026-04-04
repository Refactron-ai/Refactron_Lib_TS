// src/analysis/analyzers/base.ts
import type { AnalyzerConfig } from '../../core/config.js';
import type { CodeIssue } from '../../core/models.js';

export interface AnalyzerResult {
  issues: Omit<CodeIssue, 'blastRadius' | 'temporal'>[];
}

export abstract class BaseAnalyzer {
  abstract readonly name: string;
  abstract readonly rulePrefix: string;

  abstract analyze(filePath: string, code: string, config: AnalyzerConfig): Promise<AnalyzerResult>;

  protected makeIssueId(file: string, line: number, type: string): string {
    return `${this.rulePrefix}-${type}-${file.replace(/[^a-z0-9]/gi, '_')}-${line}`;
  }
}
