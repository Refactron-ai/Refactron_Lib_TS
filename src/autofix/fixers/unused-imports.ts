import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class UnusedImportsFixer extends BaseFixer {
  readonly name = 'unused-imports';
  readonly supportedIssueTypes = ['unused-import'];

  async fix(_filePath: string, code: string, issue: CodeIssue): Promise<TransformResult> {
    const importName = issue.message.match(/'(\w+)' is imported/)?.[1];
    if (!importName) return { transformedCode: code, description: 'No match', riskLevel: 'low' };
    const lines = code.split('\n');
    const filtered = lines.filter((line, i) => {
      if (i !== issue.line - 1) return true;
      return !new RegExp(`^(?:import\\s+${importName}|from\\s+\\S+\\s+import\\s+${importName})\\s*$`).test(line);
    });
    return { transformedCode: filtered.join('\n'), description: `Remove unused import '${importName}'`, riskLevel: 'low' };
  }
}
