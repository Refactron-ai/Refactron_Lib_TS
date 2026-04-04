import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class ConvertFstringFixer extends BaseFixer {
  readonly name = 'convert-fstring';
  readonly supportedIssueTypes = ['percent-format'];

  async fix(_filePath: string, code: string, _issue: CodeIssue): Promise<TransformResult> {
    return { transformedCode: code, description: 'Manual conversion required', riskLevel: 'high' };
  }
}
