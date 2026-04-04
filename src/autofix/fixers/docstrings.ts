import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class DocstringsFixer extends BaseFixer {
  readonly name = 'docstrings';
  readonly supportedIssueTypes = ['missing-docstring'];

  async fix(_filePath: string, code: string, issue: CodeIssue): Promise<TransformResult> {
    const lines = code.split('\n');
    const fnLine = lines[issue.line - 1] ?? '';
    const indent = fnLine.match(/^(\s*)/)?.[1] ?? '';
    lines.splice(issue.line, 0, `${indent}    """TODO: Add docstring."""`);
    return {
      transformedCode: lines.join('\n'),
      description: 'Add placeholder docstring',
      riskLevel: 'low',
    };
  }
}
