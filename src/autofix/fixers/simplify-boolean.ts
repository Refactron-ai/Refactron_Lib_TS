import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class SimplifyBooleanFixer extends BaseFixer {
  readonly name = 'simplify-boolean';
  readonly supportedIssueTypes = ['verbose-boolean'];

  async fix(_filePath: string, code: string, issue: CodeIssue): Promise<TransformResult> {
    const lines = code.split('\n');
    const line = lines[issue.line - 1] ?? '';
    lines[issue.line - 1] = line
      .replace(/(\w+)\s*==\s*True\b/g, '$1')
      .replace(/(\w+)\s*==\s*False\b/g, 'not $1');
    return { transformedCode: lines.join('\n'), description: 'Simplify boolean comparison', riskLevel: 'low' };
  }
}
