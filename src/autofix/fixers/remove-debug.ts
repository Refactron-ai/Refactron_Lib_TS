import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class RemoveDebugFixer extends BaseFixer {
  readonly name = 'remove-debug';
  readonly supportedIssueTypes = ['debug-statement'];

  async fix(_filePath: string, code: string, issue: CodeIssue): Promise<TransformResult> {
    const lines = code.split('\n');
    lines.splice(issue.line - 1, 1);
    return { transformedCode: lines.join('\n'), description: 'Remove debug statement', riskLevel: 'low' };
  }
}
