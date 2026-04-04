import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class MissingCommasFixer extends BaseFixer {
  readonly name = 'missing-commas';
  readonly supportedIssueTypes = ['missing-trailing-comma'];

  async fix(_filePath: string, code: string, issue: CodeIssue): Promise<TransformResult> {
    const lines = code.split('\n');
    const line = lines[issue.line - 1] ?? '';
    if (!line.trimEnd().endsWith(',')) {
      lines[issue.line - 1] = line.replace(/(\S)\s*$/, '$1,');
    }
    return {
      transformedCode: lines.join('\n'),
      description: 'Add trailing comma',
      riskLevel: 'low',
    };
  }
}
