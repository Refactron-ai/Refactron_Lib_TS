// src/autofix/fixers/base.ts
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export interface IFixer {
  readonly name: string;
  readonly supportedIssueTypes: string[];
  canFix(issue: CodeIssue): boolean;
  fix(filePath: string, code: string, issue: CodeIssue): Promise<TransformResult>;
}

export abstract class BaseFixer implements IFixer {
  abstract readonly name: string;
  abstract readonly supportedIssueTypes: string[];

  canFix(issue: CodeIssue): boolean {
    return issue.fixable && this.supportedIssueTypes.includes(issue.type);
  }

  abstract fix(filePath: string, code: string, issue: CodeIssue): Promise<TransformResult>;
}
