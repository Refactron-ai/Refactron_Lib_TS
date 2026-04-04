import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class NormalizeQuotesFixer extends BaseFixer {
  readonly name = 'normalize-quotes';
  readonly supportedIssueTypes = ['inconsistent-quotes'];

  async fix(filePath: string, code: string, _issue: CodeIssue): Promise<TransformResult> {
    if (filePath.endsWith('.py')) {
      return { transformedCode: code.replace(/"([^"\\]*)"/g, "'$1'"), description: 'Normalize to single quotes', riskLevel: 'low' };
    }
    return { transformedCode: code, description: 'No change', riskLevel: 'low' };
  }
}
