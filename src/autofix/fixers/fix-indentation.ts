import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class FixIndentationFixer extends BaseFixer {
  readonly name = 'fix-indentation';
  readonly supportedIssueTypes = ['mixed-indentation'];

  async fix(_filePath: string, code: string, _issue: CodeIssue): Promise<TransformResult> {
    return {
      transformedCode: code.replace(/\t/g, '    '),
      description: 'Convert tabs to 4-space indentation',
      riskLevel: 'low',
    };
  }
}
