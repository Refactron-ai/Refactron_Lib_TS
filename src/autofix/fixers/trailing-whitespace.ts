import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class TrailingWhitespaceFixer extends BaseFixer {
  readonly name = 'trailing-whitespace';
  readonly supportedIssueTypes = ['trailing-whitespace'];

  async fix(_filePath: string, code: string, _issue: CodeIssue): Promise<TransformResult> {
    return { transformedCode: code.replace(/[ \t]+$/gm, ''), description: 'Remove trailing whitespace', riskLevel: 'low' };
  }
}
