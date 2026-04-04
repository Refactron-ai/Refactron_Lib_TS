import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class TypeHintsFixer extends BaseFixer {
  readonly name = 'type-hints';
  readonly supportedIssueTypes = ['missing-return-type'];

  async fix(_filePath: string, code: string, issue: CodeIssue): Promise<TransformResult> {
    const lines = code.split('\n');
    const target = lines[issue.line - 1] ?? '';
    lines[issue.line - 1] = target.replace(/\)\s*:/, ') -> None:');
    return { transformedCode: lines.join('\n'), description: 'Add -> None return type annotation', riskLevel: 'medium' };
  }
}
