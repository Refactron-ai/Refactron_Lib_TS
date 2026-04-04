import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class MagicNumbersFixer extends BaseFixer {
  readonly name = 'magic-numbers';
  readonly supportedIssueTypes = ['magic-number'];

  async fix(_filePath: string, code: string, _issue: CodeIssue): Promise<TransformResult> {
    return { transformedCode: code, description: 'Manual review required', riskLevel: 'high' };
  }
}
